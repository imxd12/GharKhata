/**
 * GharKhata – Income Management Logic
 * Dedicated manager for Dad with Mom view permissions.
 */

(function () {
  let incomeRecords = [];
  let incomeCategories = [];
  let editingId = null;

  const IncomeApp = {
    async init() {
      if (!window.GharKhataAuth.requireAuth()) return;

      this.setupRoleUI();
      await this.loadCategories();
      await this.loadIncomes();
      this.bindEvents();

      // Listen for real-time sync events
      window.addEventListener('gharkhata:sync', (e) => {
        const type = e.detail?.type;
        if (type && type.startsWith('INCOME_')) {
          this.loadIncomes(false);
        }
      });
    },

    setupRoleUI() {
      const user = window.GharKhataAuth.getUser();
      const isDad = user && user.role === 'Dad';

      const addBtn = document.getElementById('btn-add-income');
      const roleNotice = document.getElementById('income-role-notice');

      if (addBtn) {
        if (!isDad) {
          addBtn.style.opacity = '0.6';
          addBtn.setAttribute('title', 'Only Dad has permission to add income');
        }
      }

      if (roleNotice && !isDad) {
        roleNotice.innerHTML = `
          <div class="card" style="padding:12px 18px; margin-bottom:20px; background-color:var(--role-dad-bg); border-color:var(--role-dad); color:var(--text-main);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.3rem;">👨</span>
              <div style="font-size:0.85rem;">
                <strong>Dad is the Household Income Manager:</strong> You have full visibility into all family income records, summaries and reports. Only Dad can add or modify income records.
              </div>
            </div>
          </div>
        `;
      }
    },

    async loadCategories() {
      try {
        const res = await window.GharKhataDB.request('/api/categories?type=income');
        incomeCategories = res.data || [];
        const select = document.getElementById('income-category-select');
        if (select) {
          select.innerHTML = '<option value="">Select Category</option>';
          incomeCategories.forEach(cat => {
            select.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
          });
        }

        const filterSelect = document.getElementById('filter-income-category');
        if (filterSelect) {
          filterSelect.innerHTML = '<option value="all">All Categories</option>';
          incomeCategories.forEach(cat => {
            filterSelect.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
          });
        }
      } catch (e) {
        console.warn('Could not load income categories:', e);
      }
    },

    async loadIncomes(showLoading = true) {
      const listEl = document.getElementById('income-list-container');
      if (!listEl) return;

      if (showLoading) {
        listEl.innerHTML = `
          <div class="skeleton skeleton-card" style="margin-bottom:10px;"></div>
          <div class="skeleton skeleton-card" style="margin-bottom:10px;"></div>
          <div class="skeleton skeleton-card"></div>
        `;
      }

      try {
        const search = document.getElementById('filter-income-search')?.value || '';
        const cat = document.getElementById('filter-income-category')?.value || 'all';
        const mode = document.getElementById('filter-income-mode')?.value || 'all';
        const start = document.getElementById('filter-income-start')?.value || '';
        const end = document.getElementById('filter-income-end')?.value || '';

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (cat !== 'all') params.append('category', cat);
        if (mode !== 'all') params.append('payment_mode', mode);
        if (start) params.append('start_date', start);
        if (end) params.append('end_date', end);

        const res = await window.GharKhataDB.request(`/api/income?${params.toString()}`);
        incomeRecords = res.data || [];

        // Update summary values on page
        const totalAmountEl = document.getElementById('income-total-amount');
        const totalCountEl = document.getElementById('income-total-count');
        if (totalAmountEl) {
          totalAmountEl.textContent = `₹${(res.summary?.total_amount || 0).toLocaleString()}`;
        }
        if (totalCountEl) {
          totalCountEl.textContent = `${res.summary?.total_count || 0} entries`;
        }

        this.renderList();
      } catch (e) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error Loading Incomes</div><p>${e.message}</p></div>`;
      }
    },

    renderList() {
      const listEl = document.getElementById('income-list-container');
      if (!listEl) return;

      if (incomeRecords.length === 0) {
        listEl.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon">💰</div>
            <div class="empty-state-title">No Income Records Found</div>
            <p class="empty-state-description">No income entries match your current filters. Add new household income to track your cash flow.</p>
          </div>
        `;
        return;
      }

      const user = window.GharKhataAuth.getUser();
      const isDad = user && user.role === 'Dad';

      let html = '<div class="transaction-list">';
      incomeRecords.forEach(item => {
        const formattedDate = new Date(item.date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });

        html += `
          <div class="transaction-item" data-id="${item.id}">
            <div class="transaction-left">
              <div class="transaction-icon income">
                <span>↗</span>
              </div>
              <div class="transaction-meta">
                <span class="transaction-title">${this.escapeHtml(item.description)}</span>
                <span class="transaction-subtitle">
                  <span>${formattedDate} ${item.time || ''}</span>
                  <span>•</span>
                  <span class="badge badge-income">${item.category}</span>
                  <span>•</span>
                  <span>${item.payment_mode}</span>
                  ${item.notes ? `<span>• <i title="${this.escapeHtml(item.notes)}">📝 note</i></span>` : ''}
                </span>
              </div>
            </div>
            <div class="transaction-right">
              <span class="transaction-amount income">+₹${Number(item.amount).toLocaleString()}</span>
              <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                <button class="btn btn-outline btn-sm" title="Share with Mom on WhatsApp" onclick="window.GharKhataIncome.shareWhatsApp(${item.id})">
                  <span style="color:#25d366;">💬 WhatsApp</span>
                </button>
                ${isDad ? `
                  <button class="btn btn-outline btn-sm" title="Edit Record" onclick="window.GharKhataIncome.openEditModal(${item.id})">✏️</button>
                  <button class="btn btn-outline btn-sm text-expense" title="Delete Record" onclick="window.GharKhataIncome.confirmDelete(${item.id})">🗑️</button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      });
      html += '</div>';

      listEl.innerHTML = html;
    },

    bindEvents() {
      // Add Income button
      const addBtn = document.getElementById('btn-add-income');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const user = window.GharKhataAuth.getUser();
          if (user && user.role !== 'Dad') {
            window.GharKhataNotifications.toast('Only Dad has permission to add Income records.', 'warning');
            return;
          }
          this.openAddModal();
        });
      }

      // Filter events
      const searchInput = document.getElementById('filter-income-search');
      if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => this.loadIncomes(false), 300);
        });
      }

      ['filter-income-category', 'filter-income-mode', 'filter-income-start', 'filter-income-end'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => this.loadIncomes(false));
      });

      // Income form submission
      const form = document.getElementById('income-modal-form');
      if (form) {
        form.addEventListener('submit', (e) => this.handleFormSubmit(e));
      }
    },

    openAddModal() {
      editingId = null;
      document.getElementById('income-modal-title').textContent = 'Record New Income';
      document.getElementById('income-amount').value = '';
      document.getElementById('income-description').value = '';
      document.getElementById('income-date').value = new Date().toISOString().substring(0, 10);
      document.getElementById('income-time').value = new Date().toTimeString().substring(0, 5);
      document.getElementById('income-category-select').value = '';
      document.getElementById('income-payment-mode').value = 'Bank';
      document.getElementById('income-notes').value = '';

      document.getElementById('income-modal-backdrop').classList.add('active');
    },

    openEditModal(id) {
      const item = incomeRecords.find(r => r.id === id);
      if (!item) return;

      editingId = id;
      document.getElementById('income-modal-title').textContent = 'Edit Income Record';
      document.getElementById('income-amount').value = item.amount;
      document.getElementById('income-description').value = item.description;
      document.getElementById('income-date').value = item.date;
      document.getElementById('income-time').value = item.time || '';
      document.getElementById('income-category-select').value = item.category;
      document.getElementById('income-payment-mode').value = item.payment_mode;
      document.getElementById('income-notes').value = item.notes || '';

      document.getElementById('income-modal-backdrop').classList.add('active');
    },

    closeModal() {
      document.getElementById('income-modal-backdrop').classList.remove('active');
      editingId = null;
    },

    async handleFormSubmit(e) {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('income-amount').value);
      const description = document.getElementById('income-description').value.trim();
      const date = document.getElementById('income-date').value;
      const time = document.getElementById('income-time').value;
      const category = document.getElementById('income-category-select').value;
      const payment_mode = document.getElementById('income-payment-mode').value;
      const notes = document.getElementById('income-notes').value.trim();

      if (!amount || amount <= 0 || !description || !date || !category) {
        window.GharKhataNotifications.toast('Please fill all required fields.', 'error');
        return;
      }

      const payload = { amount, description, date, time, category, payment_mode, notes };
      const submitBtn = document.getElementById('income-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        if (editingId) {
          await window.GharKhataDB.request(`/api/income/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Income record updated successfully!', 'success');
        } else {
          await window.GharKhataDB.request('/api/income', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Income added to household khata!', 'success');
        }

        this.closeModal();
        if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
          const user = window.GharKhataAuth.getUser();
          if (user && user.household_id) {
            window.GharKhataFirebase.publishSyncEvent(user.household_id, {
              type: editingId ? 'INCOME_UPDATED' : 'INCOME_ADDED',
              amount,
              description,
              category
            });
          }
        }
        await this.loadIncomes(false);
      } catch (err) {
        window.GharKhataNotifications.toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Income';
      }
    },

    confirmDelete(id) {
      const item = incomeRecords.find(r => r.id === id);
      if (!item) return;

      window.GharKhataNotifications.confirm({
        title: 'Delete Income Record',
        message: `Are you sure you want to delete the income record of ₹${Number(item.amount).toLocaleString()} ("${item.description}")? This action cannot be undone.`,
        confirmText: 'Delete',
        isDanger: true,
        onConfirm: async () => {
          try {
            await window.GharKhataDB.request(`/api/income/${id}`, { method: 'DELETE' });
            window.GharKhataNotifications.toast('Income record deleted.', 'info');
            this.loadIncomes(false);
          } catch (err) {
            window.GharKhataNotifications.toast(err.message, 'error');
          }
        }
      });
    },

    shareWhatsApp(id) {
      const item = incomeRecords.find(r => r.id === id);
      if (item && window.GharKhataWhatsApp) {
        window.GharKhataWhatsApp.shareIncomeUpdate(item);
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

  window.GharKhataIncome = IncomeApp;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('income-list-container')) {
      IncomeApp.init();
    }
  });
})();

