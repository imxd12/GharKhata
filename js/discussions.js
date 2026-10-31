/**
 * GharKhata – Expense Remarks & Discussion Logic
 * Enables Dad to inquire and Mom to reply directly on expenses.
 */

(function () {
  let activeExpenseId = null;
  let activeExpenseData = null;

  const Discussions = {
    async initPage() {
      if (!window.GharKhataAuth.requireAuth()) return;
      await this.loadActiveDiscussions();

      // Check if URL contains ?expenseId=...
      const urlParams = new URLSearchParams(window.location.search);
      const urlExpenseId = urlParams.get('expenseId');
      if (urlExpenseId) {
        this.openExpenseModal(urlExpenseId);
      }

      window.addEventListener('gharkhata:sync', (e) => {
        const type = e.detail?.type;
        if (type && (type.startsWith('REMARK_') || type.startsWith('EXPENSE_') || type === 'DISCUSSION_STATUS_CHANGED' || type === 'DATA_REFRESHED' || type === 'HOUSEHOLD_RESET')) {
          if (activeExpenseId && e.detail?.data?.expense_id === Number(activeExpenseId)) {
            this.refreshModalThread();
          }
          this.loadActiveDiscussions(false);
        }
      });
    },

    async loadActiveDiscussions(showLoading = true) {
      const container = document.getElementById('discussions-list-container');
      if (!container) return;

      if (showLoading) {
        container.innerHTML = `
          <div class="skeleton skeleton-card" style="margin-bottom:12px;"></div>
          <div class="skeleton skeleton-card"></div>
        `;
      }

      try {
        const res = await window.GharKhataDB.request('/api/discussions/active');
        const list = res.data || [];

        if (list.length === 0) {
          container.innerHTML = `
            <div class="card empty-state">
              <div class="empty-state-icon">💬</div>
              <div class="empty-state-title">No Active Discussions</div>
              <p class="empty-state-description">Dad can ask questions about any expense from the Expenses or Dashboard pages, and Mom can reply here.</p>
            </div>
          `;
          return;
        }

        let html = '<div class="transaction-list">';
        list.forEach(item => {
          const isResolved = item.has_unresolved === 0;
          const statusBadge = isResolved
            ? '<span class="badge badge-resolved">Resolved</span>'
            : '<span class="badge badge-pending">Needs Reply</span>';

          html += `
            <div class="card" style="margin-bottom:14px; cursor:pointer;" onclick="window.GharKhataDiscussions.openExpenseModal(${item.expense_id})">
              <div class="card-header" style="padding:14px 18px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <span style="font-size:1.2rem;">💬</span>
                  <div>
                    <h4 style="font-size:0.95rem; font-weight:700;">${this.escapeHtml(item.description)}</h4>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${item.date} • ${item.category} • ₹${Number(item.amount).toLocaleString()}</span>
                  </div>
                </div>
                <div>${statusBadge}</div>
              </div>
              <div class="card-body" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:0.85rem; color:var(--text-muted);">${item.message_count} message${item.message_count > 1 ? 's' : ''} in thread</span>
                <button class="btn btn-primary btn-sm">View Discussion</button>
              </div>
            </div>
          `;
        });
        html += '</div>';

        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
      }
    },

    async openExpenseModal(expenseId) {
      activeExpenseId = expenseId;
      let modal = document.getElementById('expense-discussion-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'expense-discussion-modal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="modal" style="max-width:540px;">
          <div class="modal-header">
            <div>
              <h3 id="modal-disc-expense-title">Expense Discussion</h3>
              <span id="modal-disc-expense-subtitle" style="font-size:0.8rem; color:var(--text-muted);">Loading details...</span>
            </div>
            <button class="modal-close" onclick="window.GharKhataDiscussions.closeModal()">&times;</button>
          </div>
          <div class="modal-body" style="padding:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border-color);">
              <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:600; cursor:pointer;">
                <input type="checkbox" id="modal-disc-resolve-toggle" onchange="window.GharKhataDiscussions.toggleResolved(this.checked)" />
                Mark discussion as resolved
              </label>
              <button class="btn btn-outline btn-sm" id="modal-disc-whatsapp-btn">
                <span style="color:#25d366;">💬 WhatsApp</span>
              </button>
            </div>
            <div id="modal-disc-thread" class="discussion-thread">
              <div class="skeleton skeleton-text"></div>
              <div class="skeleton skeleton-text"></div>
            </div>
          </div>
          <div class="modal-footer" style="padding:12px 16px; display:block;">
            <form id="modal-disc-form" onsubmit="window.GharKhataDiscussions.sendRemark(event)" style="display:flex; gap:8px;">
              <input type="text" id="modal-disc-input" class="form-control" placeholder="Ask a question or reply..." required />
              <button type="submit" class="btn btn-primary btn-sm" style="flex-shrink:0;">Send</button>
            </form>
          </div>
        </div>
      `;

      modal.classList.add('active');
      await this.refreshModalThread();
    },

    closeModal() {
      const modal = document.getElementById('expense-discussion-modal');
      if (modal) modal.classList.remove('active');
      activeExpenseId = null;
      activeExpenseData = null;
    },

    async refreshModalThread() {
      if (!activeExpenseId) return;

      try {
        const res = await window.GharKhataDB.request(`/api/discussions/expense/${activeExpenseId}`);
        activeExpenseData = res.expense;

        document.getElementById('modal-disc-expense-title').textContent = res.expense.description;
        document.getElementById('modal-disc-expense-subtitle').textContent = `₹${Number(res.expense.amount).toLocaleString()} • ${res.expense.category} • ${res.expense.date}`;

        const resolveCheckbox = document.getElementById('modal-disc-resolve-toggle');
        if (resolveCheckbox) {
          resolveCheckbox.checked = res.is_resolved;
        }

        const waBtn = document.getElementById('modal-disc-whatsapp-btn');
        if (waBtn) {
          waBtn.onclick = () => {
            const user = window.GharKhataAuth.getUser();
            if (user && user.role === 'Dad') {
              window.GharKhataWhatsApp.askAboutExpense(res.expense);
            } else {
              window.GharKhataWhatsApp.replyAboutExpense(res.expense, 'Regarding this expense on GharKhata:');
            }
          };
        }

        const threadEl = document.getElementById('modal-disc-thread');
        const user = window.GharKhataAuth.getUser();
        const currentUserId = user ? user.id : 0;

        if (res.messages.length === 0) {
          threadEl.innerHTML = `
            <div style="text-align:center; padding:24px 8px; color:var(--text-muted); font-size:0.85rem;">
              No remarks yet. Dad can ask questions or Mom can add remarks regarding this bill.
            </div>
          `;
          return;
        }

        let html = '';
        res.messages.forEach(msg => {
          const isMe = msg.user_id === currentUserId;
          const bubbleClass = isMe ? 'me' : 'partner';
          const roleBadge = msg.sender_role === 'Dad'
            ? '<span class="badge badge-dad">Dad</span>'
            : '<span class="badge badge-mom">Mom</span>';

          const timeFormatted = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          html += `
            <div class="discussion-bubble ${bubbleClass}">
              <div class="bubble-sender">
                <span>${this.escapeHtml(msg.sender_name)}</span>
                ${roleBadge}
              </div>
              <div>${this.escapeHtml(msg.message)}</div>
              <div class="bubble-time">${timeFormatted}</div>
            </div>
          `;
        });

        threadEl.innerHTML = html;
        // Scroll to bottom
        threadEl.scrollTop = threadEl.scrollHeight;
      } catch (e) {
        console.warn('Failed to load thread:', e);
      }
    },

    async sendRemark(e) {
      e.preventDefault();
      const input = document.getElementById('modal-disc-input');
      const message = input.value.trim();
      if (!message || !activeExpenseId) return;

      input.disabled = true;

      try {
        await window.GharKhataDB.request(`/api/discussions/expense/${activeExpenseId}`, {
          method: 'POST',
          body: JSON.stringify({ message })
        });

        input.value = '';
        if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
          const user = window.GharKhataAuth.getUser();
          if (user && user.household_id) {
            window.GharKhataFirebase.publishSyncEvent(user.household_id, {
              type: 'REMARK_ADDED',
              expense_id: Number(activeExpenseId),
              sender_role: user.role,
              message
            });
          }
        }
        await this.refreshModalThread();
      } catch (err) {
        window.GharKhataNotifications.toast(err.message, 'error');
      } finally {
        input.disabled = false;
        input.focus();
      }
    },

    async toggleResolved(isChecked) {
      if (!activeExpenseId) return;
      try {
        await window.GharKhataDB.request(`/api/discussions/expense/${activeExpenseId}/resolve`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved: isChecked })
        });
        window.GharKhataNotifications.toast(`Discussion marked as ${isChecked ? 'resolved' : 'open'}.`, 'info');
      } catch (err) {
        window.GharKhataNotifications.toast(err.message, 'error');
      }
    },

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };

  window.GharKhataDiscussions = Discussions;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('discussions-list-container')) {
      Discussions.initPage();
    }
  });
})();

