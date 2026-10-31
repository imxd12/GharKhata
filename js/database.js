/**
 * GharKhata – Client Database & API Client
 * Manages API requests, offline queueing and local cached financial snapshots
 */

(function () {
  const PENDING_QUEUE_KEY = 'gharkhata_pending_queue';
  const CACHE_KEY = 'gharkhata_cached_dashboard';

  const DB = {
    async request(endpoint, options = {}) {
      const token = window.GharKhataAuth ? window.GharKhataAuth.getToken() : null;
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const response = await fetch(endpoint, {
          ...options,
          headers
        });

        // If session expired
        if (response.status === 401) {
          if (window.GharKhataAuth) {
            window.GharKhataAuth.clearSession();
            window.location.href = 'login.html';
          }
          throw new Error('Your session has expired. Please log in again.');
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Request failed.');
        }

        return data;
      } catch (error) {
        // Handle offline scenario for write requests
        if (!navigator.onLine && options.method && options.method !== 'GET') {
          this.enqueueOfflineAction(endpoint, options);
          throw new Error('You are currently offline. This transaction has been queued and will sync automatically when reconnected.');
        }
        throw error;
      }
    },

    // Cache management for instant offline-first display
    setCache(key, data) {
      try {
        localStorage.setItem(`gharkhata_cache_${key}`, JSON.stringify({
          timestamp: Date.now(),
          data
        }));
      } catch (e) {
        console.warn('Failed to save local cache:', e);
      }
    },

    getCache(key) {
      try {
        const item = localStorage.getItem(`gharkhata_cache_${key}`);
        if (!item) return null;
        const parsed = JSON.parse(item);
        return parsed.data;
      } catch (e) {
        return null;
      }
    },

    // Offline pending transaction queue
    enqueueOfflineAction(endpoint, options) {
      try {
        const queue = this.getOfflineQueue();
        queue.push({
          id: 'action_' + Date.now(),
          endpoint,
          options,
          queuedAt: new Date().toISOString()
        });
        localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));

        if (window.GharKhataNotifications) {
          window.GharKhataNotifications.toast('Saved locally (Offline mode). Will sync automatically when online.', 'info');
        }
      } catch (e) {
        console.error('Failed to enqueue offline action:', e);
      }
    },

    getOfflineQueue() {
      try {
        const q = localStorage.getItem(PENDING_QUEUE_KEY);
        return q ? JSON.parse(q) : [];
      } catch (e) {
        return [];
      }
    },

    clearOfflineQueue() {
      localStorage.removeItem(PENDING_QUEUE_KEY);
    },

    async processOfflineQueue() {
      const queue = this.getOfflineQueue();
      if (!queue || queue.length === 0) return;

      console.log(`Processing ${queue.length} pending offline transactions...`);
      const remaining = [];

      for (const item of queue) {
        try {
          await this.request(item.endpoint, item.options);
        } catch (err) {
          console.error('Error replaying offline action:', err);
          remaining.push(item);
        }
      }

      if (remaining.length === 0) {
        this.clearOfflineQueue();
        if (window.GharKhataNotifications) {
          window.GharKhataNotifications.toast('All offline transactions have synchronized successfully!', 'success');
        }
        window.dispatchEvent(new CustomEvent('gharkhata:refresh'));
      } else {
        localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(remaining));
      }
    }
  };

  // Listen for reconnection
  window.addEventListener('online', () => {
    console.log('Network reconnected! Synchronizing pending actions...');
    DB.processOfflineQueue();
  });

  window.GharKhataDB = DB;
})();

