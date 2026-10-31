/**
 * GharKhata – Progressive Web App Service Worker
 * Offline application shell caching and background update strategy.
 */

const CACHE_NAME = 'gharkhata-v1.0.0';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/dashboard.html',
  '/income.html',
  '/expenses.html',
  '/transactions.html',
  '/analytics.html',
  '/discussions.html',
  '/reports.html',
  '/profile.html',
  '/settings.html',
  '/manifest.json',
  '/css/style.css',
  '/css/components.css',
  '/css/dashboard.css',
  '/css/auth.css',
  '/css/responsive.css',
  '/js/theme.js',
  '/js/auth.js',
  '/js/database.js',
  '/js/firebase.js',
  '/js/sync.js',
  '/js/income.js',
  '/js/expenses.js',
  '/js/discussions.js',
  '/js/analytics.js',
  '/js/whatsapp.js',
  '/js/notifications.js',
  '/js/app.js'
];

// Install: Cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📱 Service Worker pre-caching GharKhata app shell');
      return cache.addAll(APP_SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('🧹 Purging outdated cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate for app assets, Network-First for APIs
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Skip caching SSE events, uploads, and write API methods
  if (
    requestUrl.pathname.includes('/api/sync/events') ||
    requestUrl.pathname.startsWith('/uploads/') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Network-First for JSON API endpoints
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First with Network fallback for static application shell
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return networkResponse;
      });
    }).catch(() => {
      // Fallback for HTML navigation when offline
      if (event.request.mode === 'navigate') {
        return caches.match('/dashboard.html');
      }
    })
  );
});

