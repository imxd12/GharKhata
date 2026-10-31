/**
 * GharKhata – Notifications & Alert Center
 * Manages toast notifications, bell dropdown, and confirmation dialogs.
 */

(function () {
  let toastContainer = null;
  let confirmModalBackdrop = null;

  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.querySelector('.toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
      }
    }
    return toastContainer;
  }

  const Notifications = {
    toast(message, type = 'info', duration = 4000) {
      const container = ensureToastContainer();
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;

      let icon = 'ℹ️';
      if (type === 'success') icon = '✓';
      if (type === 'error') icon = '⚠️';
      if (type === 'warning') icon = '🔔';

      toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span>${icon}</span>
          <span>${message}</span>
        </div>
        <button style="background:transparent; border:none; cursor:pointer; color:inherit; font-size:1.1rem; line-height:1;" onclick="this.parentElement.remove()">×</button>
      `;

      container.appendChild(toast);

      setTimeout(() => {
        if (toast.parentElement) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(100%)';
          toast.style.transition = 'all 0.3s ease';
          setTimeout(() => toast.remove(), 300);
        }
      }, duration);
    },

    confirm(options = {}) {
      const {
        title = 'Confirm Action',
        message = 'Are you sure you want to proceed?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        isDanger = false,
        onConfirm = () => {}
      } = options;

      let backdrop = document.getElementById('global-confirm-modal');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'global-confirm-modal';
        backdrop.className = 'modal-backdrop';
        document.body.appendChild(backdrop);
      }

      backdrop.innerHTML = `
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" id="confirm-modal-close-x">&times;</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-muted); font-size:0.95rem;">${message}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm" id="confirm-modal-cancel">${cancelText}</button>
            <button class="btn ${isDanger ? 'btn-danger' : 'btn-primary'} btn-sm" id="confirm-modal-action">${confirmText}</button>
          </div>
        </div>
      `;

      backdrop.classList.add('active');

      const closeModal = () => {
        backdrop.classList.remove('active');
      };

      document.getElementById('confirm-modal-close-x').onclick = closeModal;
      document.getElementById('confirm-modal-cancel').onclick = closeModal;
      document.getElementById('confirm-modal-action').onclick = () => {
        closeModal();
        if (typeof onConfirm === 'function') {
          onConfirm();
        }
      };
    },

    async loadNotifications() {
      if (!window.GharKhataAuth || !window.GharKhataAuth.isAuthenticated()) return;
      try {
        const res = await window.GharKhataDB.request('/api/notifications');
        const badge = document.querySelector('.notifications-badge');
        if (badge) {
          if (res.unread_count > 0) {
            badge.textContent = res.unread_count > 99 ? '99+' : res.unread_count;
            badge.style.display = 'inline-flex';
          } else {
            badge.style.display = 'none';
          }
        }
        return res;
      } catch (e) {
        console.warn('Could not load notifications:', e);
      }
    },

    async markAllRead() {
      try {
        await window.GharKhataDB.request('/api/notifications/mark-all-read', { method: 'POST' });
        this.loadNotifications();
        this.toast('All notifications marked as read.', 'info');
      } catch (e) {
        this.toast(e.message, 'error');
      }
    }
  };

  window.GharKhataNotifications = Notifications;

  document.addEventListener('DOMContentLoaded', () => {
    Notifications.loadNotifications();
  });
})();

