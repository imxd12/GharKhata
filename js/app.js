/**
 * GharKhata – Main Application Shell & UI Orchestrator
 * Navigation, PWA Service Worker Registration & Global Handlers
 */

(function () {
  const App = {
    init() {
      this.renderSidebar();
      this.renderMobileNav();
      this.renderTopbarProfile();
      this.registerServiceWorker();
      this.bindGlobalEvents();
    },

    renderSidebar() {
      const sidebarContainer = document.querySelector('.app-sidebar');
      if (!sidebarContainer) return;

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (!user) return;

      const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

      const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: '📊', url: 'dashboard.html' },
        { id: 'income', label: 'Income (Dad)', icon: '💰', url: 'income.html' },
        { id: 'expenses', label: 'Expenses (Mom)', icon: '🛒', url: 'expenses.html' },
        { id: 'transactions', label: 'Daily Khata', icon: '📖', url: 'transactions.html' },
        { id: 'analytics', label: 'Analytics', icon: '📈', url: 'analytics.html' },
        { id: 'discussions', label: 'Remarks', icon: '💬', url: 'discussions.html' },
        { id: 'reports', label: 'Reports', icon: '📑', url: 'reports.html' },
        { id: 'settings', label: 'Settings', icon: '⚙️', url: 'settings.html' }
      ];

      const roleBadgeClass = user.role === 'Dad' ? 'badge-dad' : 'badge-mom';
      const avatarIcon = user.role === 'Dad' ? '👨' : '👩';

      sidebarContainer.innerHTML = `
        <div>
          <div class="sidebar-header">
            <div class="sidebar-brand">
              <div class="sidebar-brand-icon">GK</div>
              <div class="sidebar-brand-text">GharKhata</div>
            </div>
            <div class="sidebar-tagline">Your Family. Your Money. One Khata.</div>
          </div>

          <div class="sidebar-household-card">
            <div>
              <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase;">Household ID</div>
              <div class="sidebar-household-id">${user.household_id}</div>
            </div>
            <button class="sidebar-copy-btn" title="Copy Household Code" onclick="window.GharKhataApp.copyHouseholdId('${user.household_id}')">
              <span>📋 Copy</span>
            </button>
          </div>

          <nav class="sidebar-nav">
            ${navItems.map(item => `
              <a href="${item.url}" class="nav-link ${currentPage === item.id ? 'active' : ''}">
                <span class="nav-icon">${item.icon}</span>
                <span>${item.label}</span>
              </a>
            `).join('')}
          </nav>
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-user-info">
            <div class="sidebar-user-avatar">${avatarIcon}</div>
            <div class="sidebar-user-details">
              <div class="sidebar-user-name">${user.full_name}</div>
              <span class="badge ${roleBadgeClass}">${user.role}</span>
            </div>
          </div>
          <button class="btn btn-outline btn-sm" title="Log Out" onclick="window.GharKhataApp.logout()">🚪</button>
        </div>
      `;
    },

    renderMobileNav() {
      let mobileNav = document.querySelector('.mobile-bottom-nav');
      if (!mobileNav) {
        mobileNav = document.createElement('nav');
        mobileNav.className = 'mobile-bottom-nav';
        document.body.appendChild(mobileNav);
      }

      const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

      mobileNav.innerHTML = `
        <div class="mobile-nav-items">
          <a href="dashboard.html" class="mobile-nav-item ${currentPage === 'dashboard' ? 'active' : ''}">
            <span class="mobile-nav-icon">📊</span>
            <span>Home</span>
          </a>
          <a href="income.html" class="mobile-nav-item ${currentPage === 'income' ? 'active' : ''}">
            <span class="mobile-nav-icon">💰</span>
            <span>Income</span>
          </a>
          <a href="expenses.html" class="mobile-nav-item ${currentPage === 'expenses' ? 'active' : ''}">
            <span class="mobile-nav-icon">🛒</span>
            <span>Expense</span>
          </a>
          <a href="transactions.html" class="mobile-nav-item ${currentPage === 'transactions' ? 'active' : ''}">
            <span class="mobile-nav-icon">📖</span>
            <span>Khata</span>
          </a>
          <a href="settings.html" class="mobile-nav-item ${currentPage === 'settings' ? 'active' : ''}">
            <span class="mobile-nav-icon">⚙️</span>
            <span>Menu</span>
          </a>
        </div>
      `;
    },

    renderTopbarProfile() {
      const topbarActions = document.querySelector('.topbar-actions');
      if (!topbarActions) return;

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (!user) return;

      const roleBadgeClass = user.role === 'Dad' ? 'badge-dad' : 'badge-mom';

      topbarActions.innerHTML = `
        <span class="partner-pill sync-status-indicator online" title="Sync Status">
          <span class="partner-status-dot"></span>
          <span>Live Sync</span>
        </span>

        <button class="btn-icon notifications-toggle-btn" style="position:relative;" title="Notifications" onclick="window.GharKhataApp.toggleNotificationsDropdown()">
          🔔
          <span class="badge badge-expense notifications-badge" style="position:absolute; top:-4px; right:-4px; font-size:0.65rem; padding:2px 5px; display:none;">0</span>
        </button>

        <button class="btn-icon theme-toggle-btn" title="Toggle Dark/Light Mode" onclick="window.GharKhataTheme ? window.GharKhataTheme.toggle() : null">
          ${window.GharKhataTheme && window.GharKhataTheme.get() === 'dark' ? '☀️' : '🌙'}
        </button>

        <a href="profile.html" class="partner-pill" style="text-decoration:none; color:inherit;">
          <span>${user.role === 'Dad' ? '👨' : '👩'} ${user.full_name.split(' ')[0]}</span>
          <span class="badge ${roleBadgeClass}">${user.role}</span>
        </a>
      `;

      // Mount notifications dropdown
      this.mountNotificationsDropdown();
    },

    mountNotificationsDropdown() {
      let dd = document.querySelector('.notifications-dropdown');
      if (!dd) {
        dd = document.createElement('div');
        dd.className = 'notifications-dropdown';
        document.body.appendChild(dd);
      }

      dd.innerHTML = `
        <div style="padding:14px 18px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
          <h4 style="font-size:0.95rem; font-weight:700;">Notification Center</h4>
          <button class="btn btn-outline btn-sm" onclick="window.GharKhataNotifications.markAllRead()" style="padding:3px 8px; font-size:0.75rem;">Mark All Read</button>
        </div>
        <div id="notifications-items-list" style="max-height:340px; overflow-y:auto;">
          <div style="padding:18px; text-align:center; color:var(--text-muted); font-size:0.85rem;">No new notifications.</div>
        </div>
      `;
    },

    async toggleNotificationsDropdown() {
      const dd = document.querySelector('.notifications-dropdown');
      if (!dd) return;

      const isActive = dd.classList.contains('active');
      if (isActive) {
        dd.classList.remove('active');
      } else {
        dd.classList.add('active');
        await this.refreshNotificationsList();
      }
    },

    async refreshNotificationsList() {
      const listEl = document.getElementById('notifications-items-list');
      if (!listEl) return;

      try {
        const res = await window.GharKhataDB.request('/api/notifications');
        const items = res.data || [];

        if (items.length === 0) {
          listEl.innerHTML = '<div style="padding:18px; text-align:center; color:var(--text-muted); font-size:0.85rem;">No notifications recorded yet.</div>';
          return;
        }

        let html = '';
        items.forEach(n => {
          const timeFormatted = new Date(n.created_at).toLocaleString('en-IN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          html += `
            <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="window.GharKhataApp.handleNotificationClick(${n.id}, '${n.type}', ${n.reference_id || 'null'})">
              <div class="notification-item-title">${n.title}</div>
              <div class="notification-item-msg">${n.message}</div>
              <div class="notification-item-time">${timeFormatted}</div>
            </div>
          `;
        });

        listEl.innerHTML = html;
      } catch (err) {
        console.warn('Could not refresh notifications:', err);
      }
    },

    async handleNotificationClick(id, type, refId) {
      try {
        await window.GharKhataDB.request(`/api/notifications/${id}/read`, { method: 'PATCH' });
        window.GharKhataNotifications.loadNotifications();
      } catch (e) {}

      const dd = document.querySelector('.notifications-dropdown');
      if (dd) dd.classList.remove('active');

      if (type === 'remark_added' && refId) {
        window.location.href = `discussions.html?expenseId=${refId}`;
      } else if (type === 'expense_added') {
        window.location.href = 'expenses.html';
      } else if (type === 'income_added') {
        window.location.href = 'income.html';
      }
    },

    copyHouseholdId(id) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(id).then(() => {
          window.GharKhataNotifications.toast(`Household ID "${id}" copied to clipboard! Share with your partner.`, 'success');
        });
      } else {
        window.GharKhataNotifications.toast(`Household ID: ${id}`, 'info');
      }
    },

    logout() {
      window.GharKhataNotifications.confirm({
        title: 'Sign Out',
        message: 'Are you sure you want to log out of GharKhata?',
        confirmText: 'Sign Out',
        isDanger: true,
        onConfirm: () => {
          window.GharKhataAuth.logout();
        }
      });
    },

    registerServiceWorker() {
      if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js')
            .then(reg => {
              console.log('📱 GharKhata Service Worker registered:', reg.scope);
              reg.onupdatefound = () => {
                const installingWorker = reg.installing;
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    window.GharKhataNotifications.toast('A new version of GharKhata is available. Refresh to update.', 'info', 8000);
                  }
                };
              };
            })
            .catch(err => {
              console.warn('Service Worker registration skipped/failed:', err);
            });
        });
      }
    },

    bindGlobalEvents() {
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const dd = document.querySelector('.notifications-dropdown');
        const btn = document.querySelector('.notifications-toggle-btn');
        if (dd && dd.classList.contains('active') && !dd.contains(e.target) && !btn.contains(e.target)) {
          dd.classList.remove('active');
        }
      });
    }
  };

  window.GharKhataApp = App;

  document.addEventListener('DOMContentLoaded', () => {
    // Check if on protected page
    const cleanPath = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    const publicPages = ['login', 'register', 'index'];

    if (!publicPages.includes(cleanPath)) {
      if (window.GharKhataAuth && !window.GharKhataAuth.requireAuth()) {
        return;
      }
      App.init();
    }
  });
})();

