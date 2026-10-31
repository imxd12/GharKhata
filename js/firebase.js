/**
 * GharKhata – Firebase Real-Time Synchronization Layer (Firestore + RTDB)
 * Strictly used for real-time synchronization between Dad & Mom devices.
 * Zero Firebase Auth. Primary persistence remains SQLite via backend API.
 */

(function () {
  let initialLoadTime = Date.now();
  let lastProcessedTimestamp = 0;
  let lastProcessedEventId = '';

  const FirebaseSync = {
    isConfigured: false,
    firestoreDb: null,
    rtdb: null,
    unsubscribeFirestore: null,
    rtdbRef: null,
    pendingQueue: [],
    householdId: null,
    onEventCallback: null,

    init(householdId, onEventReceived) {
      this.householdId = householdId;
      this.onEventCallback = onEventReceived;
      initialLoadTime = Date.now();

      const config = window.GHAR_KHATA_FIREBASE_CONFIG;
      if (!config || !config.apiKey || config.apiKey === 'YOUR_API_KEY' || !config.projectId || config.projectId === 'YOUR_PROJECT_ID') {
        console.log('ℹ️ Firebase credentials not configured. Using SSE / heartbeat channel.');
        return false;
      }

      try {
        if (typeof firebase === 'undefined') {
          console.log('⚡ Loading Firebase Real-Time SDKs (Firestore + RTDB)...');
          this.loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', () => {
            let loadedCount = 0;
            const onSdkReady = () => {
              loadedCount++;
              if (loadedCount === 2) {
                this.setupFirebaseListeners(config, householdId);
              }
            };
            this.loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js', onSdkReady);
            this.loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js', onSdkReady);
          });
        } else {
          this.setupFirebaseListeners(config, householdId);
        }
        return true;
      } catch (err) {
        console.warn('Firebase init notice:', err.message);
        return false;
      }
    },

    loadScript(src, callback) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = callback;
      script.onerror = () => {
        console.warn('Failed to load script:', src);
        if (callback) callback();
      };
      document.head.appendChild(script);
    },

    setupFirebaseListeners(config, householdId) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(config);
        }

        // 1. Setup Firestore Real-Time Listener
        try {
          this.firestoreDb = firebase.firestore();
          const docRef = this.firestoreDb.collection('households').doc(householdId);

          this.unsubscribeFirestore = docRef.onSnapshot((doc) => {
            if (doc.exists) {
              const data = doc.data();
              this.handleRawSnapshot('Firestore', data);
            }
          }, (err) => {
            console.warn('Firestore sync listener notice:', err.message);
          });
          console.log(`🔥 Real-time Firestore sync active for Household ${householdId}`);
        } catch (fsErr) {
          console.warn('Firestore initialization notice:', fsErr.message);
        }

        // 2. Setup Realtime Database Listener (RTDB)
        if (config.databaseURL) {
          try {
            this.rtdb = firebase.database();
            this.rtdbRef = this.rtdb.ref('households/' + householdId);
            this.rtdbRef.on('value', (snapshot) => {
              const val = snapshot.val();
              if (val) {
                this.handleRawSnapshot('RTDB', val);
              }
            }, (err) => {
              console.warn('RTDB sync listener notice:', err.message);
            });
            console.log(`⚡ Real-time RTDB sync active for Household ${householdId}`);
          } catch (rtdbErr) {
            console.warn('RTDB setup notice:', rtdbErr.message);
          }
        }

        this.isConfigured = true;

        // Flush any queued writes that occurred while SDK was loading
        this.flushPendingQueue();
      } catch (e) {
        console.warn('Firebase setup error:', e);
      }
    },

    handleRawSnapshot(source, rawData) {
      if (!rawData) return;
      const eventType = rawData.type || rawData.last_event || (rawData.data && rawData.data.type);
      if (!eventType) return;

      const eventTime = Number(rawData.timestamp_ms || rawData.timestamp) || Date.parse(rawData.iso_time || rawData.timestamp || '') || 0;
      const eventId = rawData.event_id || `${eventType}_${eventTime}`;

      // Deduplicate: Don't process the exact same event twice from both Firestore & RTDB
      if (eventId && eventId === lastProcessedEventId) {
        return;
      }
      if (eventTime && eventTime === lastProcessedTimestamp) {
        return;
      }

      lastProcessedEventId = eventId;
      lastProcessedTimestamp = eventTime;

      // Check if event is from the past (prior to page load)
      const isPastEvent = eventTime > 0 && eventTime < (initialLoadTime - 2000);

      const normalized = {
        type: eventType,
        last_event: eventType,
        source: source,
        event_id: eventId,
        is_past_event: isPastEvent,
        timestamp: rawData.iso_time || (eventTime ? new Date(eventTime).toISOString() : new Date().toISOString()),
        sender_id: rawData.sender_id,
        sender_role: rawData.sender_role || (rawData.data && rawData.data.sender_role) || '',
        data: rawData.data || rawData
      };

      console.log(`📡 [${source}] Real-time sync update:`, eventType, normalized);

      if (this.onEventCallback && typeof this.onEventCallback === 'function') {
        this.onEventCallback(normalized);
      }
    },

    // Broadcast an event to both Firestore and Realtime Database
    async publishSyncEvent(householdId, eventData) {
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      const now = Date.now();
      const eventId = `${eventData.type || 'EVENT'}_${now}_${Math.random().toString(36).substring(2, 7)}`;

      const payload = {
        type: eventData.type,
        last_event: eventData.type,
        event_id: eventId,
        timestamp_ms: now,
        iso_time: new Date(now).toISOString(),
        sender_id: user ? user.id : null,
        sender_name: user ? user.full_name : '',
        sender_role: user ? user.role : '',
        data: {
          ...eventData,
          sender_role: user ? user.role : '',
          sender_name: user ? user.full_name : ''
        }
      };

      if (!this.isConfigured || (!this.firestoreDb && !this.rtdb)) {
        console.log('⏳ Firebase connecting. Queuing sync event:', eventData.type);
        this.pendingQueue.push({ householdId, payload });
        return;
      }

      this.executePublish(householdId, payload);
    },

    async executePublish(householdId, payload) {
      lastProcessedEventId = payload.event_id;
      lastProcessedTimestamp = payload.timestamp_ms;

      // 1. Write to Firestore
      if (this.firestoreDb) {
        try {
          const docRef = this.firestoreDb.collection('households').doc(householdId);
          await docRef.set(payload, { merge: true });
        } catch (err) {
          console.warn('Firestore write notice:', err.message);
        }
      }

      // 2. Write to Realtime Database (RTDB)
      if (this.rtdb) {
        try {
          const ref = this.rtdb.ref('households/' + householdId);
          await ref.set(payload);
        } catch (err) {
          console.warn('RTDB write notice:', err.message);
        }
      }
    },

    flushPendingQueue() {
      while (this.pendingQueue.length > 0) {
        const item = this.pendingQueue.shift();
        this.executePublish(item.householdId, item.payload);
      }
    },

    stop() {
      if (this.unsubscribeFirestore) {
        this.unsubscribeFirestore();
        this.unsubscribeFirestore = null;
      }
      if (this.rtdbRef) {
        this.rtdbRef.off();
        this.rtdbRef = null;
      }
    }
  };

  window.GharKhataFirebase = FirebaseSync;
})();
