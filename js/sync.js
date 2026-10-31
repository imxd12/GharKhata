/**
 * GharKhata – Unified Real-Time Synchronization Controller
 * Orchestrates Firebase Firestore sync + SSE stream fallback.
 * Ensures Dad and Mom see changes immediately with zero page refreshes.
 */

(function () {
  let eventSource = null;
  let reconnectTimeout = null;
  let retryCount = 0;

  const Sync = {
    init() {
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (!user || !user.household_id) return;

      const householdId = user.household_id;
      const token = window.GharKhataAuth.getToken();

      console.log(`📡 Initializing Real-Time Sync for Household: ${householdId} (${user.role}: ${user.full_name})`);

      // 1. Try Firebase Firestore Real-Time Sync
      if (window.GharKhataFirebase) {
        window.GharKhataFirebase.init(householdId, (event) => {
          this.handleIncomingEvent(event);
        });
      }

      // 2. Connect to Server-Sent Events stream for instant local / cross-device updates
      this.connectSSE(householdId, token);
    },

    connectSSE(householdId, token) {
      if (eventSource) {
        eventSource.close();
      }

      const sseUrl = `/api/sync/events?householdId=${encodeURIComponent(householdId)}&token=${encodeURIComponent(token || '')}`;
      eventSource = new EventSource(sseUrl);

      eventSource.onopen = () => {
        console.log('⚡ Real-time stream connected');
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
        console.warn('Real-time sync disconnected. Retrying in background...');
        this.updateSyncIndicator(false);
        eventSource.close();
        eventSource = null;

        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(1.5, retryCount), 15000);
        retryCount++;
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          if (window.GharKhataAuth && window.GharKhataAuth.isAuthenticated()) {
            this.connectSSE(householdId, token);
          }
        }, delay);
      };
    },

    handleIncomingEvent(payload) {
      console.log('🔄 Sync event received:', payload);
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      const currentRole = user ? user.role : '';
      const eventType = payload.type || payload.last_event || (payload.data && payload.data.type);

      // Notify user visually
      if (window.GharKhataNotifications) {
        const data = payload.data || payload;
        switch (eventType) {
          case 'INCOME_ADDED':
            if (currentRole === 'Mom') {
              window.GharKhataNotifications.toast(`Dad added income of ₹${data.amount?.toLocaleString()} (${data.description})`, 'success');
            }
            break;

          case 'EXPENSE_ADDED':
            if (currentRole === 'Dad') {
              window.GharKhataNotifications.toast(`Mom added expense of ₹${data.amount?.toLocaleString()} (${data.description})`, 'info');
            }
            if (data.budget_status && data.budget_status.alertMessage) {
              window.GharKhataNotifications.toast(data.budget_status.alertMessage, 'warning', 6000);
            }
            break;

          case 'REMARK_ADDED':
            if (data.sender_role !== currentRole) {
              window.GharKhataNotifications.toast(`${data.sender_role} asked a question on expense: "${data.message}"`, 'info');
            }
            break;

          case 'HOUSEHOLD_UPDATED':
            window.GharKhataNotifications.toast('Household budget & settings updated', 'info');
            break;
        }
      }

      // Notify all active page components to refresh their data without page reload
      window.dispatchEvent(new CustomEvent('gharkhata:sync', { detail: payload }));
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
      if (window.GharKhataFirebase) {
        window.GharKhataFirebase.stop();
      }
    }
  };

  window.GharKhataSync = Sync;

  // Auto-init on page load if user is logged in
  document.addEventListener('DOMContentLoaded', () => {
    if (window.GharKhataAuth && window.GharKhataAuth.isAuthenticated()) {
      Sync.init();
    }
  });
})();

