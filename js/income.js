/**
 * GharKhata – Income Management Logic
 * Dedicated manager for Dad with Mom view permissions.
 * Offline-first persistent architecture with automatic serverless container self-healing.
 */

(function () {
  let incomeRecords = [];
  let incomeCategories = [];
  let editingId = null;

  const IncomeApp = {
    getHouseholdId() {
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      return (user && user.household_id) ? user.household_id : 'default';
    },

    getStorageKey() {
      return `gharkhata_incomes_${this.getHouseholdId()}`;
    },

    getCachedRecords() {
      try {
        const raw = localStorage.getItem(this.getStorageKey());
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveCachedRecords(list) {
      try {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(list || []));
      } catch (e) {}
    },

    mergeRecords(incoming, existing) {
      const map = new Map();

      // Process existing first
      (existing || []).forEach(item => {
        if (!item) return;
        const key = (item.id && typeof item.id === 'number') 
          ? `id_${item.id}` 
          : `val_${item.description}_${item.amount}_${item.date}`;
        map.set(key, item);
      });

      // Overlay incoming authoritative records
      (incoming || []).forEach(item => {
        if (!item) return;
        const key = (item.id && typeof item.id === 'number') 
          ? `id_${item.id}` 
          : `val_${item.description}_${item.amount}_${item.date}`;
        
        // Also remove any temp key if real ID arrives
        const fallbackKey = `val_${item.description}_${item.amount}_${item.date}`;
        if (map.has(fallbackKey) && key !== fallbackKey) {
          map.delete(fallbackKey);
        }

        map.set(key, item);
      });

      const merged = Array.from(map.values());
      merged.sort((a, b) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        const timeComp = (b.time || '').localeCompare(a.time || '');
        if (timeComp !== 0) return timeComp;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });

      return merged;
    },

    updateSummaryUI(summary) {
      const totalAmountEl = document.getElementById('income-total-amount');
      const totalCountEl = document.getElementById('income-total-count');

      let totalAmount = 0;
      let totalCount = incomeRecords.length;

      if (summary && summary.total_amount !== undefined) {
        totalAmount = Number(summary.total_amount);
        totalCount = Number(summary.total_count);
      } else {
        totalAmount = incomeRecords.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
      }

      if (totalAmountEl) {
        totalAmountEl.textContent = `₹${totalAmount.toLocaleString()}`;
      }
      if (totalCountEl) {
        totalCountEl.textContent = `${totalCount} entries`;
      }
    },

    async init() {
      if (!window.GharKhataAuth.requireAuth()) return;

      // 1. Immediately hydrate and render from persistent local storage
      const cached = this.getCachedRecords();
      if (cached && cached.length > 0) {
        incomeRecords = cached;
        this.renderList();
        this.updateSummaryUI();
      }

      this.setupRoleUI();
      await this.loadCategories();
      await this.loadIncomes(false);
      this.bindEvents();

      // Listen for real-time sync events
      window.addEventListener('gharkhata:sync', (e) => {
        const type = e.detail?.type;
        const data = e.detail?.data;

        if (type === 'HOUSEHOLD_RESET') {
          localStorage.removeItem(this.getStorageKey());
          incomeRecords = [];
          this.updateSummaryUI({ total_amount: 0, total_count: 0 });
          this.renderList();
          return;
        }

        if (type === 'INCOME_DELETED' && e.detail?.id) {
          incomeRecords = incomeRecords.filter(r => r.id !== e.detail.id);
          this.saveCachedRecords(incomeRecords);
          this.updateSummaryUI();
          this.renderList();
          return;
        }

        if (type === 'INCOME_ADDED' && data && data.amount) {
          incomeRecords = this.mergeRecords([data], incomeRecords);
          this.saveCachedRecords(incomeRecords);
          this.updateSummaryUI();
          this.renderList();
        }

        if (type && (type.startsWith('INCOME_') || type === 'DATA_REFRESHED')) {
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

    populateCategoriesDropdown(select) {
      if (!select) return;
      const defaultCats = [
        'Salary',
        'Business',
        'Investment',
        'Rental',
        'Freelance',
        'Gift / Bonus',
        'Other Income'
      ];
      select.innerHTML = '<option value="">Select Category</option>';
      const catsToUse = incomeCategories.length > 0 ? incomeCategories.map(c => c.name || c) : defaultCats;
      catsToUse.forEach(name => {
        select.innerHTML += `<option value="${name}">${name}</option>`;
      });
    },

    async loadCategories() {
      const select = document.getElementById('income-category-select');
      const filterSelect = document.getElementById('filter-income-category');
      
      if (select && select.options.length <= 1) {
        this.populateCategoriesDropdown(select);
      }

      try {
        const res = await window.GharKhataDB.request('/api/categories?type=income');
        if (res.data && res.data.length > 0) {
          incomeCategories = res.data;
          if (select) {
            this.populateCategoriesDropdown(select);
          }
          if (filterSelect) {
            filterSelect.innerHTML = '<option value="all">All Categories</option>';
            incomeCategories.forEach(cat => {
              filterSelect.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
            });
          }
        }
      } catch (e) {
        console.warn('Using default income categories:', e.message);
      }
    },

    async loadIncomes(showLoading = true) {
      const listEl = document.getElementById('income-list-container');
      if (!listEl) return;

      if (showLoading && incomeRecords.length === 0) {
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

        const isFiltered = search.trim() !== '' || cat !== 'all' || mode !== 'all' || start !== '' || end !== '';

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (cat !== 'all') params.append('category', cat);
        if (mode !== 'all') params.append('payment_mode', mode);
        if (start) params.append('start_date', start);
        if (end) params.append('end_date', end);

        const res = await window.GharKhataDB.request(`/api/income?${params.toString()}`);
        const serverRecords = res.data || [];

        if (serverRecords.length > 0) {
          // Merge server records with locally known records
          incomeRecords = this.mergeRecords(serverRecords, incomeRecords);
          this.saveCachedRecords(incomeRecords);
          this.updateSummaryUI(res.summary);
          this.renderList();
        } else {
          // If server returned 0 records
          if (isFiltered) {
            // Legitimate 0 matches for active filter
            incomeRecords = [];
            this.updateSummaryUI({ total_amount: 0, total_count: 0 });
            this.renderList();
          } else {
            // Cold serverless instance check
            const cached = this.getCachedRecords();
            if (cached && cached.length > 0) {
              console.log('🔄 Cold serverless container returned 0 records. Auto-restoring SQLite backend from client storage...');
              incomeRecords = cached;
              this.updateSummaryUI();
              this.renderList();

              // Trigger background SQLite re-hydration
              window.GharKhataDB.request('/api/sync/restore', {
                method: 'POST',
                body: JSON.stringify({ incomes: cached })
              }).catch(err => console.warn('Sync restore notice:', err.message));
            } else {
              incomeRecords = [];
              this.updateSummaryUI({ total_amount: 0, total_count: 0 });
              this.renderList();
            }
          }
        }
      } catch (e) {
        // Fallback to local cache if offline or server temporarily unavailable
        const cached = this.getCachedRecords();
        if (cached && cached.length > 0) {
          incomeRecords = cached;
          this.updateSummaryUI();
          this.renderList();
        } else {
          listEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error Loading Incomes</div><p>${e.message}</p></div>`;
        }
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
                <button class="btn btn-outline btn-sm" title="Share with Mom on WhatsApp" onclick="window.GharKhataIncome.shareWhatsApp('${item.id}')">
                  <span style="color:#25d366;">💬 WhatsApp</span>
                </button>
                ${isDad ? `
                  <button class="btn btn-outline btn-sm" title="Edit Record" onclick="window.GharKhataIncome.openEditModal('${item.id}')">✏️</button>
                  <button class="btn btn-outline btn-sm text-expense" title="Delete Record" onclick="window.GharKhataIncome.confirmDelete('${item.id}')">🗑️</button>
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
      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (user && user.role !== 'Dad') {
        window.GharKhataNotifications.toast('Only Dad has permission to manage Income records.', 'warning');
        return;
      }

      editingId = null;
      const titleEl = document.getElementById('income-modal-title');
      if (titleEl) titleEl.textContent = 'Record New Income';

      const amtEl = document.getElementById('income-amount');
      if (amtEl) amtEl.value = '';
      const descEl = document.getElementById('income-description');
      if (descEl) descEl.value = '';
      const dateEl = document.getElementById('income-date');
      if (dateEl) dateEl.value = new Date().toISOString().substring(0, 10);
      const timeEl = document.getElementById('income-time');
      if (timeEl) timeEl.value = new Date().toTimeString().substring(0, 5);
      
      const select = document.getElementById('income-category-select');
      if (select) {
        if (select.options.length <= 1) {
          this.populateCategoriesDropdown(select);
        }
        select.value = '';
      }

      const modeEl = document.getElementById('income-payment-mode');
      if (modeEl) modeEl.value = 'Bank';
      const notesEl = document.getElementById('income-notes');
      if (notesEl) notesEl.value = '';

      const backdrop = document.getElementById('income-modal-backdrop');
      if (backdrop) backdrop.classList.add('active');
    },

    openEditModal(id) {
      const item = incomeRecords.find(r => String(r.id) === String(id));
      if (!item) return;

      const user = window.GharKhataAuth ? window.GharKhataAuth.getUser() : null;
      if (user && user.role !== 'Dad') {
        window.GharKhataNotifications.toast('Only Dad has permission to edit Income records.', 'warning');
        return;
      }

      editingId = id;
      const titleEl = document.getElementById('income-modal-title');
      if (titleEl) titleEl.textContent = 'Edit Income Record';

      const amtEl = document.getElementById('income-amount');
      if (amtEl) amtEl.value = item.amount;
      const descEl = document.getElementById('income-description');
      if (descEl) descEl.value = item.description;
      const dateEl = document.getElementById('income-date');
      if (dateEl) dateEl.value = item.date;
      const timeEl = document.getElementById('income-time');
      if (timeEl) timeEl.value = item.time || '';

      const select = document.getElementById('income-category-select');
      if (select) {
        if (select.options.length <= 1) {
          this.populateCategoriesDropdown(select);
        }
        select.value = item.category;
      }

      const modeEl = document.getElementById('income-payment-mode');
      if (modeEl) modeEl.value = item.payment_mode;
      const notesEl = document.getElementById('income-notes');
      if (notesEl) notesEl.value = item.notes || '';

      const backdrop = document.getElementById('income-modal-backdrop');
      if (backdrop) backdrop.classList.add('active');
    },

    closeModal() {
      const backdrop = document.getElementById('income-modal-backdrop');
      if (backdrop) backdrop.classList.remove('active');
      editingId = null;
    },

    async handleFormSubmit(e) {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('income-amount')?.value);
      const description = document.getElementById('income-description')?.value.trim();
      const date = document.getElementById('income-date')?.value;
      const time = document.getElementById('income-time')?.value || new Date().toTimeString().substring(0, 5);
      const category = document.getElementById('income-category-select')?.value;
      const payment_mode = document.getElementById('income-payment-mode')?.value || 'Bank';
      const notes = document.getElementById('income-notes')?.value.trim();

      if (!amount || amount <= 0 || !description || !date || !category) {
        window.GharKhataNotifications.toast('Please fill all required fields (Amount, Description, Category, Date).', 'error');
        return;
      }

      const user = window.GharKhataAuth.getUser();
      const tempId = editingId || ('temp_' + Date.now());

      const localItem = {
        id: tempId,
        amount,
        description,
        date,
        time,
        category,
        payment_mode,
        notes,
        user_id: user ? user.id : null,
        added_by_name: user ? user.full_name : 'Dad',
        added_by_role: 'Dad',
        created_at: new Date().toISOString()
      };

      // 1. Immediately persist to local cache and render to avoid ANY flicker or empty state
      if (editingId) {
        incomeRecords = incomeRecords.map(r => String(r.id) === String(editingId) ? { ...r, ...localItem } : r);
      } else {
        incomeRecords = [localItem, ...incomeRecords.filter(r => String(r.id) !== String(tempId))];
      }

      this.saveCachedRecords(incomeRecords);
      this.updateSummaryUI();
      this.renderList();
      this.closeModal();

      const payload = { amount, description, date, time, category, payment_mode, notes };
      const submitBtn = document.getElementById('income-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      try {
        let serverRes;
        if (editingId) {
          serverRes = await window.GharKhataDB.request(`/api/income/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Income record updated successfully!', 'success');
        } else {
          serverRes = await window.GharKhataDB.request('/api/income', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          window.GharKhataNotifications.toast('Income added to household khata!', 'success');
        }

        // Reconcile temporary ID with authoritative server ID
        const realId = serverRes.id || (serverRes.data && serverRes.data.id);
        if (realId) {
          incomeRecords = incomeRecords.map(r => String(r.id) === String(tempId) ? { ...r, id: realId } : r);
          this.saveCachedRecords(incomeRecords);
          this.renderList();
        }

        const finalItem = {
          ...localItem,
          id: realId || tempId
        };

        // Broadcast to Firebase for instant partner synchronization
        if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
          if (user && user.household_id) {
            window.GharKhataFirebase.publishSyncEvent(user.household_id, {
              type: editingId ? 'INCOME_UPDATED' : 'INCOME_ADDED',
              ...finalItem
            });
          }
        }

        // Trigger local sync across components on the current page
        window.dispatchEvent(new CustomEvent('gharkhata:sync', {
          detail: { type: editingId ? 'INCOME_UPDATED' : 'INCOME_ADDED', data: finalItem }
        }));

      } catch (err) {
        window.GharKhataNotifications.toast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Income';
        }
      }
    },

    confirmDelete(id) {
      const item = incomeRecords.find(r => String(r.id) === String(id));
      if (!item) return;

      window.GharKhataNotifications.confirm({
        title: 'Delete Income Record',
        message: `Are you sure you want to delete the income record of ₹${Number(item.amount).toLocaleString()} ("${item.description}")? This action cannot be undone.`,
        confirmText: 'Delete',
        isDanger: true,
        onConfirm: async () => {
          // Immediately update UI and cache
          incomeRecords = incomeRecords.filter(r => String(r.id) !== String(id));
          this.saveCachedRecords(incomeRecords);
          this.updateSummaryUI();
          this.renderList();

          try {
            if (typeof id === 'number' || !String(id).startsWith('temp_')) {
              await window.GharKhataDB.request(`/api/income/${id}`, { method: 'DELETE' });
            }
            window.GharKhataNotifications.toast('Income record deleted.', 'info');
            
            // Broadcast delete event to partner device
            if (window.GharKhataFirebase && window.GharKhataFirebase.publishSyncEvent) {
              const user = window.GharKhataAuth.getUser();
              if (user && user.household_id) {
                window.GharKhataFirebase.publishSyncEvent(user.household_id, {
                  type: 'INCOME_DELETED',
                  id,
                  amount: item.amount,
                  description: item.description
                });
              }
            }
            window.dispatchEvent(new CustomEvent('gharkhata:sync', {
              detail: { type: 'INCOME_DELETED', id, amount: item.amount, description: item.description }
            }));

          } catch (err) {
            window.GharKhataNotifications.toast(err.message, 'error');
          }
        }
      });
    },

    shareWhatsApp(id) {
      const item = incomeRecords.find(r => String(r.id) === String(id));
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
    if (document.getElementById('income-list-container') || document.getElementById('income-modal-backdrop') || document.getElementById('btn-add-income')) {
      IncomeApp.init();
    }
  });
})();