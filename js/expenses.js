/**
 * GharKhata – Expense Management Logic
 * Dedicated manager for Mom with Dad review & remarks capabilities.
 */

(function () {
  let expenseRecords = [];
  let expenseCategories = [];
  let editingId = null;
  let receiptBase64 = null;
  let receiptFilename = null;

  const ExpenseApp = {
    async init() {
      if (!window.GharKhataAuth.requireAuth()) return;

      this.setupRoleUI();
      await this.loadCategories();
      await this.loadExpenses();
      this.bindEvents();

      // Listen for real-time sync events
      window.addEventListener('gharkhata:sync', (e) => {
        const type = e.detail?.type;
        if (type && (type.startsWith('EXPENSE_') || type.startsWith('REMARK_') || type === 'DATA_REFRESHED' || type === 'HOUSEHOLD_RESET')) {
          this.loadExpenses(false);
        }
      });
    },

    setupRoleUI() {
      const user = window.GharKhataAuth.getUser();
      const isMom = user && user.role === 'Mom';

      const addBtn = document.getElementById('btn-add-expense');
      const roleNotice = document.getElementById('expense-role-notice');

      if (addBtn && !isMom) {
        addBtn.style.opacity = '0.6';
        addBtn.setAttribute('title', 'Only Mom has permission to add expenses');
      }

      if (roleNotice && !isMom) {
        roleNotice.innerHTML = `
          <div class="card" style="padding:12px 18px; margin-bottom:20px; background-color:var(--role-mom-bg); border-color:var(--role-mom); color:var(--text-main);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.3rem;">👩</span>
              <div style="font-size:0.85rem;">
                <strong>Mom is the Household Expense Manager:</strong> You have full visibility into all family expense records, bills and receipts. You can add questions and remarks directly to any expense or contact Mom on WhatsApp.
              </div>
            </div>
          </div>
        `;
      }
    },

    populateCategoriesDropdown(select) {
      if (!select) return;
      const defaultCats = [
        'Groceries',
        'Electricity',
        'Water',
        'Rent',
        'Medical',
        'Education',
        'Transport',
        'Food',
        'Shopping',
        'Household',
        'Others'
      ];
      select.innerHTML = '<option value="">Select Category</option>';
      const catsToUse = expenseCategories.length > 0 ? expenseCategories.map(c => c.name || c) : defaultCats;
      catsToUse.forEach(name => {
        select.innerHTML += `<option value="${name}">${name}</option>`;
      });
    },

    async loadCategories() {
      const select = document.getElementById('expense-category-select');
      const filterSelect = document.getElementById('filter-expense-category');

      // Ensure defaults immediately so dropdown is never blank
      if (select && select.options.length <= 1) {
        this.populateCategoriesDropdown(select);
      }

      try {
        const res = await window.GharKhataDB.request('/api/categories?type=expense');
        if (res.data && res.data.length > 0) {
          expenseCategories = res.data;
          if (select) {
            this.populateCategoriesDropdown(select);
          }
          if (filterSelect) {
            filterSelect.innerHTML = '<option value="all">All Categories</option>';
            expenseCategories.forEach(cat => {
              filterSelect.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
            });
          }
        }
      } catch (e) {
        console.warn('Using default expense categories:', e.message);
      }
    },

    async loadExpenses(showLoading = true) {
      const listEl = document.getElementById('expense-list-container');
      if (!listEl) return;

      if (showLoading) {
        listEl.innerHTML = `
          <div class="skeleton skeleton-card" style="margin-bottom:10px;"></div>
          <div class="skeleton skeleton-card" style="margin-bottom:10px;"></div>
          <div class="skeleton skeleton-card"></div>
        `;
      }

      try {
        const search = document.getElementById('filter-expense-search')?.value || '';
        const cat = document.getElementById('filter-expense-category')?.value || 'all';
        const mode = document.getElementById('filter-expense-mode')?.value || 'all';
        const start = document.getElementById('filter-expense-start')?.value || '';
        const end = document.getElementById('filter-expense-end')?.value || '';

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (cat !== 'all') params.append('category', cat);
        if (mode !== 'all') params.append('payment_mode', mode);
        if (start) params.append('start_date', start);
        if (end) params.append('end_date', end);

        const res = await window.GharKhataDB.request(`/api/expenses?${params.toString()}`);
        expenseRecords = res.data || [];

        // Update summary values on page
        const totalAmountEl = document.getElementById('expense-total-amount');
        const totalCountEl = document.getElementById('expense-total-count');
        if (totalAmountEl) {
          totalAmountEl.textContent = `₹${(res.summary?.total_amount || 0).toLocaleString()}`;
        }
        if (totalCountEl) {
          totalCountEl.textContent = `${res.summary?.total_count || 0} entries`;
        }

        this.renderList();
      } catch (e) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error Loading Expenses</div><p>${e.message}</p></div>`;
      }
    },

    renderList() {
      const listEl = document.getElementById('expense-list-container');
      if (!listEl) return;

      if (expenseRecords.length === 0) {
        listEl.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon">🛒</div>
            <div class="empty-state-title">No Expense Records Found</div>
            <p class="empty-state-description">No expense entries match your current search or date range filters.</p>
          </div>
        `;
        return;
      }

      const user = window.GharKhataAuth.getUser();
      const isMom = user && user.role === 'Mom';

      let html = '<div class="transaction-list">';
      expenseRecords.forEach(item => {
        const formattedDate = new Date(item.date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });

        const remarksBadge = item.remarks_count > 0
          ? `<span class="badge ${item.unresolved_remarks_count > 0 ? 'badge-pending' : 'badge-resolved'}" style="cursor:pointer;" onclick="window.GharKhataDiscussions.openExpenseModal(${item.id})">💬 ${item.remarks_count} remark${item.remarks_count > 1 ? 's' : ''}</span>`
          : `<span class="badge badge-secondary" style="cursor:pointer; opacity:0.8;" onclick="window.GharKhataDiscussions.openExpenseModal(${item.id})">+ Add Remark</span>`;

        const receiptBadge = item.receipt_url
          ? `<button class="btn btn-outline btn-sm" style="padding:3px 8px;" onclick="window.GharKhataExpenses.viewReceipt('${item.receipt_url}', '${this.escapeHtml(item.description)}')">📎 Bill</button>`
          : '';

        html += `
          <div class="transaction-item" data-id="${item.id}">
            <div class="transaction-left">
              <div class="transaction-icon expense">
                <span>↙</span>
              </div>
              <div class="transaction-meta">
                <span class="transaction-title">${this.escapeHtml(item.description)}</span>
                <span class="transaction-subtitle">
                  <span>${formattedDate} ${item.time || ''}</span>
                  <span>•</span>
                  <span class="badge badge-expense">${item.category}</span>
                  <span>•</span>
                  <span>${item.payment_mode}</span>
                  ${item.notes ? `<span>• <i title="${this.escapeHtml(item.notes)}">📝 note</i></span>` : ''}
                </span>
              </div>
            </div>
            <div class="transaction-right">
              <span class="transaction-amount expense">-₹${Number(item.amount).toLocaleString()}</span>
              <div style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap; justify-content:flex-end;">
                ${receiptBadge}
                ${remarksBadge}
                <button class="btn btn-outline btn-sm" title="Contact on WhatsApp" onclick="window.GharKhataExpenses.openWhatsApp(${item.id})">
                  <span style="color:#25d366;">💬 WhatsApp</span>
                </button>
                ${isMom ? `
                  <button class="btn btn-outline btn-sm" title="Edit Record" onclick="window.GharKhataExpenses.openEditModal(${item.id})">✏️</button>
                  <button class="btn btn-outline btn-sm text-expense" title="Delete Record" onclick="window.GharKhataExpenses.confirmDelete(${item.id})">🗑️</button>
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
      // Add Expense button
      const addBtn = document.getElementById('btn-add-expense');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const user = window.GharKhataAuth.getUser();
          if (user && user.role !== 'Mom') {
            window.GharKhataNotifications.toast('Only Mom has permission to add Expense records.', 'warning');
            return;
          }
          this.openAddModal();
        });
      }

      // Filter events
      const searchInput = document.getElementById('filter-expense-search');
      if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => this.loadExpenses(false), 300);
        });
      }

      ['filter-expense-category', 'filter-expense-mode', 'filter-expense-start', 'filter-expense-end'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => this.loadExpenses(false));
      });

      // Receipt file picker
      const receiptInput = document.getElementById('expense-receipt-file');
      if (receiptInput) {
        receiptInput.addEventListener('change', (e) => this.handleReceiptFileSelect(e));
      }

      // Remove receipt button
      const removeReceiptBtn = document.getElementById('expense-remove-receipt-btn');
      if (removeReceiptBtn) {
        removeReceiptBtn.addEventListener('click', () => this.clearReceipt());
      }

      // Form submit
      const form = document.getElementById('expense-modal-form');
      if (form) {
        form.addEventListener('submit', (e) => this.handleFormSubmit(e));
      }
    },

    handleReceiptFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        window.GharKhataNotifications.toast('File size exceeds 5MB limit.', 'error');
        e.target.value = '';
        return;
      }

      receiptFilename = file.name;
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        receiptBase64 = loadEvent.target.result;
        this.renderReceiptPreview(receiptBase64, file.name);
      };
      reader.readAsDataURL(file);
    },

    renderReceiptPreview(dataUrl, name) {
      const previewContainer = document.getElementById('expense-receipt-preview-box');
      if (!previewContainer) return;

      previewContainer.style.display = 'flex';
      const img = document.getElementById('expense-receipt-preview-img');
      const filenameText = document.getElementById('expense-receipt-filename');

      if (name.endsWith('.pdf')) {
        img.src = '';
        img.style.display = 'none';
        filenameText.textContent = `📄 ${name}`;
      } else {
        img.src = dataUrl;
        img.style.display = 'block';
        filenameText.textContent = name;
      }
    },

    clearReceipt() {
      receiptBase64 = null;
      receiptFilename = null;
      const fileInput = document.getElementById('expense-receipt-file');
      if (fileInput) fileInput.value = '';

      const previewContainer = document.getElementById('expense-receipt-preview-box');
      if (previewContainer) previewContainer.style.display = 'none';
    },

    openAddModal() {
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (user && user.role !== 'Mom') {
        window.GharKhataNotifications.toast('Only Mom has permission to manage Expense records.', 'warning');
        return;
      }

      editingId = null;
      this.clearReceipt();
      const titleEl = document.getElementById('expense-modal-title');
      if (titleEl) titleEl.textContent = 'Record New Expense';

      const amtEl = document.getElementById('expense-amount');
      if (amtEl) amtEl.value = '';
      const descEl = document.getElementById('expense-description');
      if (descEl) descEl.value = '';
      const dateEl = document.getElementById('expense-date');
      if (dateEl) dateEl.value = new Date().toISOString().substring(0, 10);
      const timeEl = document.getElementById('expense-time');
      if (timeEl) timeEl.value = new Date().toTimeString().substring(0, 5);

      const select = document.getElementById('expense-category-select');
      if (select) {
        if (select.options.length <= 1) {
          this.populateCategoriesDropdown(select);
        }
        select.value = '';
      }

      const modeEl = document.getElementById('expense-payment-mode');
      if (modeEl) modeEl.value = 'UPI';
      const notesEl = document.getElementById('expense-notes');
      if (notesEl) notesEl.value = '';

      const backdrop = document.getElementById('expense-modal-backdrop');
      if (backdrop) backdrop.classList.add('active');
    },

    openEditModal(id) {
      const item = expenseRecords.find(r => r.id === id);
      if (!item) return;

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (user && user.role !== 'Mom') {
        window.GharKhataNotifications.toast('Only Mom has permission to edit Expense records.', 'warning');
        return;
      }

      editingId = id;
      this.clearReceipt();
      const titleEl = document.getElementById('expense-modal-title');
      if (titleEl) titleEl.textContent = 'Edit Expense Record';

      const amtEl = document.getElementById('expense-amount');
      if (amtEl) amtEl.value = item.amount;
      const descEl = document.getElementById('expense-description');
      if (descEl) descEl.value = item.description;
      const dateEl = document.getElementById('expense-date');
      if (dateEl) dateEl.value = item.date;
      const timeEl = document.getElementById('expense-time');
      if (timeEl) timeEl.value = item.time || '';

      const select = document.getElementById('expense-category-select');
      if (select) {
        if (select.options.length <= 1) {
          this.populateCategoriesDropdown(select);
        }
        select.value = item.category;
      }

      const modeEl = document.getElementById('expense-payment-mode');
      if (modeEl) modeEl.value = item.payment_mode;
      const notesEl = document.getElementById('expense-notes');
      if (notesEl) notesEl.value = item.notes || '';

      if (item.receipt_url) {
        this.renderReceiptPreview(item.receipt_url, item.receipt_filename || 'receipt.jpg');
      }

      const backdrop = document.getElementById('expense-modal-backdrop');
      if (backdrop) backdrop.classList.add('active');
    },

    closeModal() {
      const backdrop = document.getElementById('expense-modal-backdrop');
      if (backdrop) backdrop.classList.remove('active');
      editingId = null;
      this.clearReceipt();
    },

    async handleFormSubmit(e) {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('expense-amount')?.value);
      const description = document.getElementById('expense-description')?.value.trim();
      const date = document.getElementById('expense-date')?.value;
      const time = document.getElementById('expense-time')?.value || new Date().toTimeString().substring(0, 5);
      const category = document.getElementById('expense-category-select')?.value;
      const payment_mode = document.getElementById('expense-payment-mode')?.value || 'UPI';
      const notes = document.getElementById('expense-notes')?.value.trim();

      if (!amount || amount <= 0 || !description || !date || !category) {
        window.GharKhataNotifications.toast('Please fill all required fields (Amount, Description, Category, Date).', 'error');
        return;
      }

      const payload = {
        amount,
        description,
        date,
        time,
        category,
        payment_mode,
        notes,
        receipt_data: receiptBase64,
        receipt_filename: receiptFilename
      };

      const submitBtn = document.getElementById('expense-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      try {
        if (editingId) {
          await window.GharKhataDB.request(`/api/expenses/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Expense record updated successfully!', 'success');
        } else {
          const res = await window.GharKhataDB.request('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Expense logged successfully!', 'success');
          if (res.budget_status && res.budget_status.alertMessage) {
            window.GharKhataNotifications.toast(res.budget_status.alertMessage, 'warning', 6000);
          }
        }

        this.closeModal();

        // Broadcast to Firebase sync if available
        if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
          const user = window.GharKhataAuth.getUser();
          if (user && user.household_id) {
            window.GharKhataFirebase.publishSyncEvent(user.household_id, {
              type: editingId ? 'EXPENSE_UPDATED' : 'EXPENSE_ADDED',
              amount,
              description,
              category
            });
          }
        }

        // Trigger local sync across all components on current page
        window.dispatchEvent(new CustomEvent('gharkhata:sync', {
          detail: { type: editingId ? 'EXPENSE_UPDATED' : 'EXPENSE_ADDED', amount, description, category }
        }));

        if (document.getElementById('expense-list-container')) {
          await this.loadExpenses(false);
        }
      } catch (err) {
        window.GharKhataNotifications.toast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Expense';
        }
      }
    },

    confirmDelete(id) {
      const item = expenseRecords.find(r => r.id === id);
      if (!item) return;

      window.GharKhataNotifications.confirm({
        title: 'Delete Expense Record',
        message: `Are you sure you want to delete the expense of ₹${Number(item.amount).toLocaleString()} ("${item.description}")? This action cannot be undone.`,
        confirmText: 'Delete',
        isDanger: true,
        onConfirm: async () => {
          try {
            await window.GharKhataDB.request(`/api/expenses/${id}`, { method: 'DELETE' });
            window.GharKhataNotifications.toast('Expense record deleted.', 'info');

            // Broadcast delete event to partner device
            if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
              const user = window.GharKhataAuth.getUser();
              if (user && user.household_id) {
                window.GharKhataFirebase.publishSyncEvent(user.household_id, {
                  type: 'EXPENSE_DELETED',
                  id,
                  amount: item.amount,
                  description: item.description
                });
              }
            }
            window.dispatchEvent(new CustomEvent('gharkhata:sync', {
              detail: { type: 'EXPENSE_DELETED', id, amount: item.amount, description: item.description }
            }));

            this.loadExpenses(false);
          } catch (err) {
            window.GharKhataNotifications.toast(err.message, 'error');
          }
        }
      });
    },

    viewReceipt(url, desc) {
      let modal = document.getElementById('receipt-view-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receipt-view-modal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
      }

      const isPdf = url.endsWith('.pdf');

      modal.innerHTML = `
        <div class="modal" style="max-width:700px;">
          <div class="modal-header">
            <h3>Receipt – ${this.escapeHtml(desc)}</h3>
            <button class="modal-close" onclick="document.getElementById('receipt-view-modal').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body" style="text-align:center; padding:16px;">
            ${isPdf ? `
              <embed src="${url}" type="application/pdf" width="100%" height="480px" />
            ` : `
              <img src="${url}" alt="Receipt" style="max-width:100%; max-height:540px; border-radius:var(--radius-md); box-shadow:var(--shadow-sm);" />
            `}
          </div>
          <div class="modal-footer">
            <a href="${url}" download class="btn btn-secondary btn-sm" target="_blank">⬇️ Download File</a>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('receipt-view-modal').classList.remove('active')">Close</button>
          </div>
        </div>
      `;

      modal.classList.add('active');
    },

    openWhatsApp(id) {
      const item = expenseRecords.find(r => r.id === id);
      if (!item || !window.GharKhataWhatsApp) return;

      const user = window.GharKhataAuth.getUser();
      if (user && user.role === 'Dad') {
        window.GharKhataWhatsApp.askAboutExpense(item);
      } else {
        window.GharKhataWhatsApp.replyAboutExpense(item, 'Check this expense in our GharKhata!');
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

  window.GharKhataExpenses = ExpenseApp;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('expense-list-container') || document.getElementById('expense-modal-backdrop') || document.getElementById('btn-add-expense')) {
      ExpenseApp.init();
    }
  });
})();

