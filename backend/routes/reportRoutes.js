/**
 * GharKhata – Financial Reports & Analytics Routes
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll } = require('../database');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

router.use(authenticateUser);

/**
 * GET /api/reports/dashboard
 * Aggregated metrics for main overview dashboard
 */
router.get('/dashboard', (req, res) => {
  try {
    const householdId = req.user.household_id;
    const now = new Date();
    const currentMonthPrefix = now.toISOString().substring(0, 7); // 'YYYY-MM'
    const todayStr = now.toISOString().substring(0, 10); // 'YYYY-MM-DD'

    // 1. Lifetime Totals
    const lifetimeIncome = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE household_id = ?',
      [householdId]
    ).total;

    const lifetimeExpense = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE household_id = ?',
      [householdId]
    ).total;

    const remainingBalance = lifetimeIncome - lifetimeExpense;

    // 2. Current Month Metrics
    const monthIncome = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE household_id = ? AND date LIKE ?',
      [householdId, `${currentMonthPrefix}%`]
    ).total;

    const monthExpense = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE household_id = ? AND date LIKE ?',
      [householdId, `${currentMonthPrefix}%`]
    ).total;

    // 3. Today Metrics
    const todayIncome = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE household_id = ? AND date = ?',
      [householdId, todayStr]
    ).total;

    const todayExpense = queryOne(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE household_id = ? AND date = ?',
      [householdId, todayStr]
    ).total;

    // 4. Household Budget details
    const household = queryOne(
      'SELECT monthly_budget, currency FROM households WHERE id = ?',
      [householdId]
    );

    const monthlyBudget = household ? household.monthly_budget : 50000;
    const budgetPercent = monthlyBudget > 0 ? Math.round((monthExpense / monthlyBudget) * 100) : 0;

    // 5. Category-wise expense breakdown (Current Month)
    const categoryBreakdown = queryAll(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses
       WHERE household_id = ? AND date LIKE ?
       GROUP BY category
       ORDER BY total DESC`,
      [householdId, `${currentMonthPrefix}%`]
    );

    // 6. Last 6 Months Trend (Income vs Expense)
    // Generating month list for the past 6 calendar months
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prefix = d.toISOString().substring(0, 7);
      const monthLabel = d.toLocaleString('default', { month: 'short', year: '2-digit' });

      const inc = queryOne(
        'SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE household_id = ? AND date LIKE ?',
        [householdId, `${prefix}%`]
      ).total;

      const exp = queryOne(
        'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE household_id = ? AND date LIKE ?',
        [householdId, `${prefix}%`]
      ).total;

      monthlyTrend.push({
        month: monthLabel,
        key: prefix,
        income: inc,
        expense: exp,
        savings: inc - exp
      });
    }

    // 7. Recent Transactions (unified incomes and expenses)
    const recentIncomes = queryAll(
      `SELECT id, amount, date, time, category, payment_mode, description, notes, 'income' as type,
              created_at, 'Dad' as managed_by
       FROM incomes
       WHERE household_id = ?
       ORDER BY date DESC, time DESC, id DESC
       LIMIT 10`,
      [householdId]
    );

    const recentExpenses = queryAll(
      `SELECT e.id, e.amount, e.date, e.time, e.category, e.payment_mode, e.description, e.receipt_url, e.notes, 'expense' as type,
              e.created_at, 'Mom' as managed_by,
              (SELECT COUNT(*) FROM discussions d WHERE d.expense_id = e.id) as remarks_count
       FROM expenses e
       WHERE e.household_id = ?
       ORDER BY e.date DESC, e.time DESC, e.id DESC
       LIMIT 10`,
      [householdId]
    );

    const combinedRecent = [...recentIncomes, ...recentExpenses]
      .sort((a, b) => {
        const dateComp = b.date.localeCompare(a.date);
        if (dateComp !== 0) return dateComp;
        return (b.time || '').localeCompare(a.time || '');
      })
      .slice(0, 10);

    // 8. Partner Info
    const partner = queryOne(
      'SELECT id, full_name, role, phone, email FROM users WHERE household_id = ? AND id != ?',
      [householdId, req.user.id]
    );

    return res.json({
      success: true,
      data: {
        summary: {
          lifetime_income: lifetimeIncome,
          lifetime_expense: lifetimeExpense,
          balance: remainingBalance,
          month_income: monthIncome,
          month_expense: monthExpense,
          today_income: todayIncome,
          today_expense: todayExpense,
          monthly_budget: monthlyBudget,
          budget_spent_percent: budgetPercent,
          currency: household ? household.currency : 'INR'
        },
        category_breakdown: categoryBreakdown,
        monthly_trend: monthlyTrend,
        recent_transactions: combinedRecent,
        partner: partner || null
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/reports/analytics
 * Comprehensive visual analytics data (breakdowns, daily timelines, payment modes)
 */
router.get('/analytics', (req, res) => {
  try {
    const householdId = req.user.household_id;
    const { start_date, end_date } = req.query;

    let dateFilterInc = '';
    let dateFilterExp = '';
    const paramsInc = [householdId];
    const paramsExp = [householdId];

    if (start_date) {
      dateFilterInc += ' AND date >= ?';
      dateFilterExp += ' AND date >= ?';
      paramsInc.push(start_date);
      paramsExp.push(start_date);
    }
    if (end_date) {
      dateFilterInc += ' AND date <= ?';
      dateFilterExp += ' AND date <= ?';
      paramsInc.push(end_date);
      paramsExp.push(end_date);
    }

    // Expense Categories
    const expenseCategories = queryAll(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses
       WHERE household_id = ? ${dateFilterExp}
       GROUP BY category
       ORDER BY total DESC`,
      paramsExp
    );

    // Income Categories
    const incomeCategories = queryAll(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM incomes
       WHERE household_id = ? ${dateFilterInc}
       GROUP BY category
       ORDER BY total DESC`,
      paramsInc
    );

    // Payment Modes for Expenses
    const expensePaymentModes = queryAll(
      `SELECT payment_mode, SUM(amount) as total, COUNT(*) as count
       FROM expenses
       WHERE household_id = ? ${dateFilterExp}
       GROUP BY payment_mode
       ORDER BY total DESC`,
      paramsExp
    );

    // Payment Modes for Incomes
    const incomePaymentModes = queryAll(
      `SELECT payment_mode, SUM(amount) as total, COUNT(*) as count
       FROM incomes
       WHERE household_id = ? ${dateFilterInc}
       GROUP BY payment_mode
       ORDER BY total DESC`,
      paramsInc
    );

    // Daily breakdown for timeline graph
    const dailyIncomes = queryAll(
      `SELECT date, SUM(amount) as income_total
       FROM incomes
       WHERE household_id = ? ${dateFilterInc}
       GROUP BY date
       ORDER BY date ASC`,
      paramsInc
    );

    const dailyExpenses = queryAll(
      `SELECT date, SUM(amount) as expense_total
       FROM expenses
       WHERE household_id = ? ${dateFilterExp}
       GROUP BY date
       ORDER BY date ASC`,
      paramsExp
    );

    return res.json({
      success: true,
      data: {
        expense_categories: expenseCategories,
        income_categories: incomeCategories,
        expense_payment_modes: expensePaymentModes,
        income_payment_modes: incomePaymentModes,
        daily_incomes: dailyIncomes,
        daily_expenses: dailyExpenses
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/reports/transactions
 * Unified Khata transaction history with rich search and filtering
 */
router.get('/transactions', (req, res) => {
  try {
    const householdId = req.user.household_id;
    const { type, search, category, payment_mode, start_date, end_date, limit = 100 } = req.query;

    let incomes = [];
    let expenses = [];

    // Fetch Incomes if type is 'all' or 'income'
    if (!type || type === 'all' || type === 'income') {
      let q = `
        SELECT i.id, i.amount, i.date, i.time, i.category, i.payment_mode, i.description, 
               i.notes, NULL as receipt_url, 0 as remarks_count, 'income' as type, 
               u.full_name as added_by_name, u.role as added_by_role, i.created_at
        FROM incomes i
        JOIN users u ON i.user_id = u.id
        WHERE i.household_id = ?
      `;
      const p = [householdId];

      if (search && search.trim()) {
        q += ` AND (i.description LIKE ? OR i.notes LIKE ? OR i.category LIKE ?)`;
        const term = `%${search.trim()}%`;
        p.push(term, term, term);
      }
      if (category && category !== 'all') {
        q += ` AND i.category = ?`;
        p.push(category);
      }
      if (payment_mode && payment_mode !== 'all') {
        q += ` AND i.payment_mode = ?`;
        p.push(payment_mode);
      }
      if (start_date) {
        q += ` AND i.date >= ?`;
        p.push(start_date);
      }
      if (end_date) {
        q += ` AND i.date <= ?`;
        p.push(end_date);
      }

      incomes = queryAll(q, p);
    }

    // Fetch Expenses if type is 'all' or 'expense'
    if (!type || type === 'all' || type === 'expense') {
      let q = `
        SELECT e.id, e.amount, e.date, e.time, e.category, e.payment_mode, e.description, 
               e.notes, e.receipt_url, e.receipt_filename,
               (SELECT COUNT(*) FROM discussions d WHERE d.expense_id = e.id) as remarks_count,
               'expense' as type, 
               u.full_name as added_by_name, u.role as added_by_role, e.created_at
        FROM expenses e
        JOIN users u ON e.user_id = u.id
        WHERE e.household_id = ?
      `;
      const p = [householdId];

      if (search && search.trim()) {
        q += ` AND (e.description LIKE ? OR e.notes LIKE ? OR e.category LIKE ?)`;
        const term = `%${search.trim()}%`;
        p.push(term, term, term);
      }
      if (category && category !== 'all') {
        q += ` AND e.category = ?`;
        p.push(category);
      }
      if (payment_mode && payment_mode !== 'all') {
        q += ` AND e.payment_mode = ?`;
        p.push(payment_mode);
      }
      if (start_date) {
        q += ` AND e.date >= ?`;
        p.push(start_date);
      }
      if (end_date) {
        q += ` AND e.date <= ?`;
        p.push(end_date);
      }

      expenses = queryAll(q, p);
    }

    // Combine and sort chronological descending
    const combined = [...incomes, ...expenses]
      .sort((a, b) => {
        const dateComp = b.date.localeCompare(a.date);
        if (dateComp !== 0) return dateComp;
        return (b.time || '').localeCompare(a.time || '');
      })
      .slice(0, parseInt(limit, 10));

    return res.json({
      success: true,
      data: combined,
      count: combined.length
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/reports/audit-logs
 * Household financial change audit trail
 */
router.get('/audit-logs', (req, res) => {
  try {
    const logs = queryAll(
      `SELECT * FROM audit_logs
       WHERE household_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.household_id]
    );

    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/reports/export/csv
 * Export complete transactions to clean CSV
 */
router.get('/export/csv', (req, res) => {
  try {
    const householdId = req.user.household_id;

    const incomes = queryAll(
      `SELECT 'Income' as Type, date as Date, time as Time, category as Category,
              payment_mode as 'Payment Mode', amount as Amount, description as Description,
              notes as Notes, 'Dad' as 'Added By'
       FROM incomes
       WHERE household_id = ?`,
      [householdId]
    );

    const expenses = queryAll(
      `SELECT 'Expense' as Type, date as Date, time as Time, category as Category,
              payment_mode as 'Payment Mode', amount as Amount, description as Description,
              notes as Notes, 'Mom' as 'Added By'
       FROM expenses
       WHERE household_id = ?`,
      [householdId]
    );

    const rows = [...incomes, ...expenses].sort((a, b) => b.Date.localeCompare(a.Date));

    // CSV format generator
    const headers = ['Type', 'Date', 'Time', 'Category', 'Payment Mode', 'Amount (INR)', 'Description', 'Notes', 'Added By'];
    let csv = headers.join(',') + '\r\n';

    for (const row of rows) {
      const line = [
        row.Type,
        row.Date,
        row.Time || '',
        `"${(row.Category || '').replace(/"/g, '""')}"`,
        row['Payment Mode'] || '',
        row.Amount,
        `"${(row.Description || '').replace(/"/g, '""')}"`,
        `"${(row.Notes || '').replace(/"/g, '""')}"`,
        row['Added By']
      ];
      csv += line.join(',') + '\r\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=GharKhata_${householdId}_${new Date().toISOString().substring(0,10)}.csv`);
    return res.send(csv);

  } catch (error) {
    return res.status(500).send('Error generating CSV report: ' + error.message);
  }
});

module.exports = router;
