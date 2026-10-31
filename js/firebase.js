/**
 * GharKhata – Firebase Firestore Real-Time Synchronization Layer
 * NOTE: Used SOLELY for real-time synchronization. No Firebase Auth.
 * Persistent primary database is SQLite via the backend API.
 */

(function () {
  const FirebaseSync = {
    isConfigured: false,
    db: null,
    unsubscribe: null,

    init(householdId, onEventReceived) {
      const config = window.GHAR_KHATA_FIREBASE_CONFIG;

      // Check if user has provided real Firebase credentials
      if (!config || !config.apiKey || config.apiKey === 'YOUR_API_KEY' || !config.projectId || config.projectId === 'YOUR_PROJECT_ID') {
        console.log('ℹ️ Firebase credentials not provided. Using local real-time synchronization channel.');
        return false;
      }

      try {
        // Dynamically load Firebase SDK if not already loaded
        if (typeof firebase === 'undefined') {
          console.log('Connecting to Firebase Firestore for real-time household sync...');
          const scriptApp = document.createElement('script');
          scriptApp.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
          scriptApp.onload = () => {
            const scriptFs = document.createElement('script');
            scriptFs.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js';
            scriptFs.onload = () => {
              this.setupFirestoreListener(config, householdId, onEventReceived);
            };
            document.head.appendChild(scriptFs);
          };
          document.head.appendChild(scriptApp);
        } else {
          this.setupFirestoreListener(config, householdId, onEventReceived);
        }

        return true;
      } catch (err) {
        console.warn('Firebase initialization error:', err.message);
        return false;
      }
    },

    setupFirestoreListener(config, householdId, callback) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(config);
        }
        this.db = firebase.firestore();
        this.isConfigured = true;

        const docRef = this.db.collection('households').doc(householdId);

        // Listen for real-time document changes
        this.unsubscribe = docRef.onSnapshot((doc) => {
          if (doc.exists) {
            const data = doc.data();
            console.log('🔥 Real-time sync update from Firestore:', data);
            if (callback && typeof callback === 'function') {
              callback(data);
            }
          }
        }, (err) => {
          console.warn('Firestore subscription notice:', err.message);
        });

        console.log(`🔥 Real-time Firestore sync active for Household ${householdId}`);
      } catch (e) {
        console.warn('Firestore setup error:', e);
      }
    },

    // Broadcast an event to Firestore when Dad or Mom makes a financial change
    async publishSyncEvent(householdId, eventData) {
      if (!this.isConfigured || !this.db) return;

      try {
        const docRef = this.db.collection('households').doc(householdId);
        await docRef.set({
          last_event: eventData.type,
          timestamp: new Date().toISOString(),
          data: eventData
        }, { merge: true });
      } catch (err) {
        console.warn('Firestore write warning:', err.message);
      }
    },

    stop() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    }
  };

  window.GharKhataFirebase = FirebaseSync;
})();

