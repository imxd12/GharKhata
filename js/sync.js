/**
 * GharKhata – Unified Real-Time Synchronization Controller
 * Orchestrates Firebase Firestore/RTDB sync + SSE stream + cross-device heartbeat polling.
 * Guarantees Dad and Mom see changes immediately with zero manual page refreshes.
 */

(function () {
  let eventSource = null;
  let reconnectTimeout = null;
  let retryCount = 0;
  let pollInterval = null;
  let lastKnownStateHash = '';
  let broadcastChannel = null;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      broadcastChannel = new BroadcastChannel('gharkhata_sync_bus');
    } catch (e) {}
  }

  const Sync = {
    init() {
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (!user || !user.household_id) return;

      const householdId = user.household_id;
      const token = window.GharKhataAuth.getToken();

      console.log(`📡 Initializing Real-Time Sync for Household: ${householdId} (${user.role}: ${user.full_name})`);

      // 1. Firebase Firestore & Realtime Database sync
      if (window.GharKhataFirebase) {
        window.GharKhataFirebase.init(householdId, (event) => {
          this.handleIncomingEvent(event);
        });
      }

      // 2. Server-Sent Events stream
      this.connectSSE(householdId, token);

      // 3. Cross-Tab BroadcastChannel listener
      if (broadcastChannel) {
        broadcastChannel.onmessage = (e) => {
          if (e.data && e.data.type) {
            this.dispatchLocalSync(e.data);
          }
        };
      }

      // 4. Background Heartbeat Poll (guarantees cross-device sync across cell networks)
      this.startHeartbeat(householdId);
    },

    connectSSE(householdId, token) {
      if (eventSource) {
        eventSource.close();
      }

      const apiBase = (window.GharKhataAuth && typeof window.GharKhataAuth.getApiBase === 'function')
        ? window.GharKhataAuth.getApiBase()
        : '';
      const sseUrl = `${apiBase}/api/sync/events?householdId=${encodeURIComponent(householdId)}&token=${encodeURIComponent(token || '')}`;

      try {
        eventSource = new EventSource(sseUrl);

        eventSource.onopen = () => {
          console.log('⚡ Real-time SSE stream connected');
          retryCount = 0;
          this.updateSyncIndicator(true);
        };

        eventSource.onmessage = (e) => {
          try {
            const payload = JSON.parse(e.data);
            if (payload.type === 'CONNECTED') return;
            this.handleIncomingEvent(payload);
          } catch (err) {
            console.warn('Malformed event stream data:', err);
          }
        };

        eventSource.onerror = () => {
          this.updateSyncIndicator(false);
          if (eventSource) eventSource.close();
          eventSource = null;

          const delay = Math.min(1500 * Math.pow(1.5, retryCount), 15000);
          retryCount++;
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            if (window.GharKhataAuth && window.GharKhataAuth.isAuthenticated()) {
              this.connectSSE(householdId, token);
            }
          }, delay);
        };
      } catch (e) {
        console.warn('SSE connection notice:', e.message);
      }
    },

    startHeartbeat(householdId) {
      if (pollInterval) clearInterval(pollInterval);

      // Poll every 4 seconds when the user is viewing the page
      pollInterval = setInterval(async () => {
        if (document.hidden) return; // Save battery/data when tab is in background
        if (!window.GharKhataAuth || !window.GharKhataAuth.isAuthenticated()) return;

        try {
          const res = await window.GharKhataDB.request('/api/reports/dashboard');
          if (res && res.data && res.data.summary) {
            const s = res.data.summary;
            const recents = res.data.recent_transactions || [];
            const latestId = recents.length > 0 ? recents[0].id : 0;
            const currentHash = `${s.lifetime_income}_${s.lifetime_expense}_${latestId}_${recents.length}`;

            if (lastKnownStateHash && lastKnownStateHash !== currentHash) {
              console.log('🔄 Heartbeat detected ledger change on partner device, synchronizing UI...');
              this.dispatchLocalSync({ type: 'DATA_REFRESHED', source: 'heartbeat' });
            }
            lastKnownStateHash = currentHash;
          }
        } catch (e) {
          // Silent catch for heartbeat
        }
      }, 4000);
    },

    handleIncomingEvent(payload) {
      if (!payload) return;
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      const currentRole = user ? user.role : '';
      const currentUserId = user ? user.id : null;

      const eventType = payload.type || payload.last_event || (payload.data && payload.data.type) || 'EVENT_UPDATED';
      const senderRole = payload.sender_role || (payload.data && payload.data.sender_role) || '';
      const senderId = payload.sender_id || (payload.data && payload.data.sender_id) || null;

      const normalizedDetail = {
        type: eventType,
        last_event: eventType,
        source: payload.source || 'sync',
        sender_role: senderRole,
        sender_id: senderId,
        data: payload.data || payload
      };

      // Notify partner visually via toast (only if not a past event on page load and not sent by self)
      const isFromSelf = senderId && currentUserId && senderId === currentUserId;
      if (!payload.is_past_event && !isFromSelf && window.GharKhataNotifications) {
        const data = payload.data || payload;
        switch (eventType) {
          case 'INCOME_ADDED':
            if (currentRole === 'Mom') {
              window.GharKhataNotifications.toast(`💰 Dad recorded income of ₹${Number(data.amount || 0).toLocaleString()} (${data.description || 'Income'})`, 'success', 5000);
            }
            break;

          case 'INCOME_DELETED':
            if (currentRole === 'Mom') {
              window.GharKhataNotifications.toast(`ℹ️ Dad deleted an income record (${data.description || ''})`, 'info', 4000);
            }
            break;

          case 'EXPENSE_ADDED':
            if (currentRole === 'Dad') {
              window.GharKhataNotifications.toast(`🛒 Mom logged expense of ₹${Number(data.amount || 0).toLocaleString()} (${data.description || 'Expense'})`, 'info', 5000);
            }
            if (data.budget_status && data.budget_status.alertMessage) {
              window.GharKhataNotifications.toast(data.budget_status.alertMessage, 'warning', 6000);
            }
            break;

          case 'EXPENSE_DELETED':
            if (currentRole === 'Dad') {
              window.GharKhataNotifications.toast(`ℹ️ Mom deleted an expense record (${data.description || ''})`, 'info', 4000);
            }
            break;

          case 'REMARK_ADDED':
            if (senderRole && senderRole !== currentRole) {
              window.GharKhataNotifications.toast(`💬 ${senderRole} asked a question: "${data.message || ''}"`, 'info', 5000);
            }
            break;

          case 'HOUSEHOLD_RESET':
            window.GharKhataNotifications.toast(`⚠️ Khata was reset to ₹0 by ${senderRole || 'partner'}.`, 'warning', 6000);
            break;

          case 'HOUSEHOLD_UPDATED':
            window.GharKhataNotifications.toast('Household budget & currency updated.', 'info');
            break;
        }
      }

      // Propagate locally across current tab components
      this.dispatchLocalSync(normalizedDetail);

      // Propagate to other browser tabs on same device
      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage(normalizedDetail);
        } catch (e) {}
      }
    },

    dispatchLocalSync(detail) {
      // Dispatch custom event to window so all components on current page refresh data
      window.dispatchEvent(new CustomEvent('gharkhata:sync', { detail }));
    },

    updateSyncIndicator(isConnected) {
      const indicators = document.querySelectorAll('.sync-status-indicator');
      indicators.forEach(el => {
        el.classList.toggle('online', isConnected);
        el.classList.toggle('offline', !isConnected);
        el.setAttribute('title', isConnected ? 'Real-time synchronization connected' : 'Connecting to real-time sync...');
      });
    },

    disconnect() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (window.GharKhataFirebase) {
        window.GharKhataFirebase.stop();
      }
    }
  };

  window.GharKhataSync = Sync;

  document.addEventListener('DOMContentLoaded', () => {
    if (window.GharKhataAuth && window.GharKhataAuth.isAuthenticated()) {
      Sync.init();
    }
  });
})();
