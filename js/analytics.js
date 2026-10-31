/**
 * GharKhata – Financial Analytics & Charting Logic
 * Category breakdown, monthly comparison & spending trends.
 */

(function () {
  let categoryChartInstance = null;
  let comparisonChartInstance = null;
  let paymentModeChartInstance = null;

  const Analytics = {
    async init() {
      if (!window.GharKhataAuth.requireAuth()) return;
      await this.loadAnalyticsData();
      this.bindEvents();

      window.addEventListener('gharkhata:sync', () => {
        this.loadAnalyticsData();
      });
    },

    bindEvents() {
      const rangeSelect = document.getElementById('analytics-range-select');
      if (rangeSelect) {
        rangeSelect.addEventListener('change', () => this.loadAnalyticsData());
      }
    },

    async loadAnalyticsData() {
      try {
        const range = document.getElementById('analytics-range-select')?.value || 'month';
        const now = new Date();
        let startDate = '';
        let endDate = now.toISOString().substring(0, 10);

        if (range === 'month') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10);
        } else if (range === 'quarter') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().substring(0, 10);
        } else if (range === 'year') {
          startDate = new Date(now.getFullYear(), 0, 1).toISOString().substring(0, 10);
        }

        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        // Fetch analytics data and dashboard summary
        const [analyticsRes, dashboardRes] = await Promise.all([
          window.GharKhataDB.request(`/api/reports/analytics?${params.toString()}`),
          window.GharKhataDB.request('/api/reports/dashboard')
        ]);

        this.renderCategoryChart(analyticsRes.data?.expense_categories || []);
        this.renderComparisonChart(dashboardRes.data?.monthly_trend || []);
        this.renderPaymentModeChart(analyticsRes.data?.expense_payment_modes || []);
        this.renderCategoryTable(analyticsRes.data?.expense_categories || []);
        this.renderHighlights(dashboardRes.data?.summary, analyticsRes.data);

      } catch (err) {
        console.warn('Analytics loading notice:', err);
      }
    },

    renderCategoryChart(categories) {
      const canvas = document.getElementById('chart-category-breakdown');
      if (!canvas) return;

      if (!categories || categories.length === 0) {
        const container = canvas.parentElement;
        container.innerHTML = '<div class="empty-state"><p>No expense data available for this timeframe.</p></div>';
        return;
      }

      const labels = categories.map(c => c.category);
      const data = categories.map(c => c.total);

      const colors = [
        '#059669', '#10b981', '#34d399', '#6ee7b7',
        '#d97706', '#f59e0b', '#fbbf24', '#fcd34d',
        '#dc2626', '#ef4444', '#f87171', '#2563eb'
      ];

      if (categoryChartInstance) {
        categoryChartInstance.destroy();
      }

      if (typeof Chart !== 'undefined') {
        categoryChartInstance = new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels,
            datasets: [{
              data,
              backgroundColor: colors.slice(0, categories.length),
              borderWidth: 2,
              borderColor: 'var(--bg-surface)'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  boxWidth: 12,
                  font: { family: 'inherit', size: 12 }
                }
              }
            }
          }
        });
      }
    },

    renderComparisonChart(monthlyTrend) {
      const canvas = document.getElementById('chart-monthly-comparison');
      if (!canvas) return;

      const labels = monthlyTrend.map(m => m.month);
      const incomeData = monthlyTrend.map(m => m.income);
      const expenseData = monthlyTrend.map(m => m.expense);

      if (comparisonChartInstance) {
        comparisonChartInstance.destroy();
      }

      if (typeof Chart !== 'undefined') {
        comparisonChartInstance = new Chart(canvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Income (Dad)',
                data: incomeData,
                backgroundColor: '#059669',
                borderRadius: 4
              },
              {
                label: 'Expenses (Mom)',
                data: expenseData,
                backgroundColor: '#dc2626',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: val => '₹' + val.toLocaleString()
                }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                labels: { boxWidth: 12 }
              }
            }
          }
        });
      }
    },

    renderPaymentModeChart(paymentModes) {
      const canvas = document.getElementById('chart-payment-modes');
      if (!canvas) return;

      const labels = paymentModes.map(p => p.payment_mode);
      const data = paymentModes.map(p => p.total);

      if (paymentModeChartInstance) {
        paymentModeChartInstance.destroy();
      }

      if (typeof Chart !== 'undefined') {
        paymentModeChartInstance = new Chart(canvas, {
          type: 'pie',
          data: {
            labels,
            datasets: [{
              data,
              backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6'],
              borderWidth: 2,
              borderColor: 'var(--bg-surface)'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12 } }
            }
          }
        });
      }
    },

    renderCategoryTable(categories) {
      const tbody = document.getElementById('analytics-category-tbody');
      if (!tbody) return;

      if (!categories || categories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:18px;">No expenses logged for this period.</td></tr>';
        return;
      }

      const totalSum = categories.reduce((acc, c) => acc + c.total, 0);

      let html = '';
      categories.forEach(c => {
        const percent = totalSum > 0 ? Math.round((c.total / totalSum) * 100) : 0;
        html += `
          <tr>
            <td style="font-weight:600;">${c.category}</td>
            <td>₹${Number(c.total).toLocaleString()}</td>
            <td>${percent}%</td>
            <td>${c.count} transactions</td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
    },

    renderHighlights(summary, analytics) {
      const savingsRateEl = document.getElementById('highlight-savings-rate');
      const topCatEl = document.getElementById('highlight-top-category');

      if (summary && savingsRateEl) {
        const income = summary.month_income || 0;
        const expense = summary.month_expense || 0;
        if (income > 0) {
          const rate = Math.round(((income - expense) / income) * 100);
          savingsRateEl.textContent = `${rate}%`;
          savingsRateEl.className = rate >= 20 ? 'text-income' : 'text-expense';
        } else {
          savingsRateEl.textContent = '0%';
        }
      }

      if (analytics?.expense_categories?.length > 0 && topCatEl) {
        const top = analytics.expense_categories[0];
        topCatEl.textContent = `${top.category} (₹${top.total.toLocaleString()})`;
      }
    }
  };

  window.GharKhataAnalytics = Analytics;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('chart-category-breakdown')) {
      Analytics.init();
    }
  });
})();

