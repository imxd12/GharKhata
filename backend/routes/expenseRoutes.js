/**
 * GharKhata – Expense Management Routes
 * Managed exclusively by Mom. Dad can view all household expenses.
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser, requireMom } = require('../middleware/authMiddleware');
const { saveBase64Receipt } = require('../middleware/uploadMiddleware');
const { broadcastEvent } = require('../syncBroadcaster');

const router = Router();

router.use(authenticateUser);

/**
 * Check and generate budget alerts if spending hits 70%, 90% or 100%
 */
function checkBudgetAlerts(householdId, currentMonthStr) {
  const household = queryOne('SELECT monthly_budget FROM households WHERE id = ?', [householdId]);
  if (!household || !household.monthly_budget || household.monthly_budget <= 0) return null;

  const budget = household.monthly_budget;
  const monthPrefix = currentMonthStr.substring(0, 7); // 'YYYY-MM'

  const spentRow = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as total_spent
     FROM expenses
     WHERE household_id = ? AND date LIKE ?`,
    [householdId, `${monthPrefix}%`]
  );

  const totalSpent = spentRow.total_spent;
  const percent = Math.round((totalSpent / budget) * 100);

  let alertLevel = null;
  let alertMessage = null;

  if (percent >= 100) {
    alertLevel = 100;
    alertMessage = `🚨 Critical: Monthly budget reached 100%! Spent ₹${totalSpent.toLocaleString()} of ₹${budget.toLocaleString()} budget.`;
  } else if (percent >= 90) {
    alertLevel = 90;
    alertMessage = `⚠️ Caution: Monthly expenses at 90% of budget! Spent ₹${totalSpent.toLocaleString()} of ₹${budget.toLocaleString()}.`;
  } else if (percent >= 70) {
    alertLevel = 70;
    alertMessage = `📊 Note: Monthly expenses have reached 70% of budget (₹${totalSpent.toLocaleString()} / ₹${budget.toLocaleString()}).`;
  }

  if (alertLevel) {
    // Check if we already alerted this level this month to prevent spamming
    const existing = queryOne(
      `SELECT id FROM notifications 
       WHERE household_id = ? AND type = 'budget_alert' AND title LIKE ? AND created_at LIKE ?`,
      [householdId, `%${alertLevel}%`, `${monthPrefix}%`]
    );

    if (!existing) {
      const now = new Date().toISOString();
      execute(
        `INSERT INTO notifications (household_id, user_id, type, title, message, created_at)
         VALUES (?, NULL, 'budget_alert', ?, ?, ?)`,
        [householdId, `Budget Alert (${alertLevel}%)`, alertMessage, now]
      );
    }
  }

  return { percent, totalSpent, budget, alertLevel, alertMessage };
}

/**
 * GET /api/expenses
 * View all household expenses (accessible by both Dad and Mom)
 */
router.get('/', (req, res) => {
  try {
    const { search, category, payment_mode, start_date, end_date } = req.query;
    let query = `
      SELECT e.*, COALESCE(u.full_name, 'Mom') as added_by_name, COALESCE(u.role, 'Mom') as added_by_role,
             (SELECT COUNT(*) FROM discussions d WHERE d.expense_id = e.id) as remarks_count,
             (SELECT COUNT(*) FROM discussions d WHERE d.expense_id = e.id AND d.is_resolved = 0) as unresolved_remarks_count
      FROM expenses e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.household_id = ?
    `;
    const params = [req.user.household_id];

    if (search && search.trim()) {
      query += ` AND (e.description LIKE ? OR e.notes LIKE ? OR e.category LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (category && category !== 'all') {
      query += ` AND e.category = ?`;
      params.push(category);
    }

    if (payment_mode && payment_mode !== 'all') {
      query += ` AND e.payment_mode = ?`;
      params.push(payment_mode);
    }

    if (start_date) {
      query += ` AND e.date >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND e.date <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY e.date DESC, e.time DESC, e.id DESC`;

    const records = queryAll(query, params);

    const summary = queryOne(
      `SELECT COUNT(*) as total_count, COALESCE(SUM(amount), 0) as total_amount
       FROM expenses
       WHERE household_id = ?`,
      [req.user.household_id]
    );

    return res.json({
      success: true,
      data: records,
      summary: {
        total_count: summary.total_count,
        total_amount: summary.total_amount
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/expenses/:id
 * Retrieve single expense with discussion summary
 */
router.get('/:id', (req, res) => {
  try {
    const record = queryOne(
      `SELECT e.*, COALESCE(u.full_name, 'Mom') as added_by_name, COALESCE(u.role, 'Mom') as added_by_role
       FROM expenses e
       LEFT JOIN users u ON e.user_id = u.id
       WHERE e.id = ? AND e.household_id = ?`,
      [req.params.id, req.user.household_id]
    );

    if (!record) {
      return res.status(404).json({ success: false, message: 'Expense record not found.' });
    }

    const remarks = queryAll(
      `SELECT d.*, COALESCE(u.full_name, d.sender_name) as full_name, COALESCE(u.role, d.sender_role) as role
       FROM discussions d
       LEFT JOIN users u ON d.user_id = u.id
       WHERE d.expense_id = ?
       ORDER BY d.created_at ASC`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: {
        ...record,
        discussions: remarks
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/expenses
 * Add new expense – Strictly permitted for Mom only
 */
router.post('/', requireMom, (req, res) => {
  try {
    const {
      amount,
      date,
      time,
      category,
      payment_mode,
      description,
      notes,
      receipt_data,
      receipt_filename
    } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
    }

    if (!date || !category || !payment_mode || !description) {
      return res.status(400).json({
        success: false,
        message: 'Please provide Date, Category, Payment Mode, and Description.'
      });
    }

    const validPaymentModes = ['Cash', 'UPI', 'Bank', 'Other'];
    if (!validPaymentModes.includes(payment_mode)) {
      return res.status(400).json({
        success: false,
        message: 'Payment mode must be Cash, UPI, Bank, or Other.'
      });
    }

    // Process receipt attachment if present
    let receiptUrl = null;
    let savedFilename = null;
    if (receipt_data) {
      try {
        const uploadResult = saveBase64Receipt(receipt_data, receipt_filename);
        receiptUrl = uploadResult.receipt_url;
        savedFilename = uploadResult.receipt_filename;
      } catch (uploadErr) {
        return res.status(400).json({ success: false, message: uploadErr.message });
      }
    }

    const now = new Date().toISOString();
    const entryTime = time || new Date().toTimeString().substring(0, 5);

    const insertResult = execute(
      `INSERT INTO expenses (household_id, user_id, amount, date, time, category, payment_mode, description, receipt_url, receipt_filename, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        parseFloat(amount),
        date,
        entryTime,
        category.trim(),
        payment_mode,
        description.trim(),
        receiptUrl,
        savedFilename,
        notes ? notes.trim() : null,
        now,
        now
      ]
    );

    const newId = Number(insertResult.lastInsertRowid);

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'CREATE_EXPENSE', 'expenses', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        newId,
        `Added expense: ₹${amount} for "${description}" (${category})`,
        now
      ]
    );

    // Send notification to Dad
    execute(
      `INSERT INTO notifications (household_id, user_id, type, title, message, reference_id, created_at)
       VALUES (?, NULL, 'expense_added', 'New Expense Added', ?, ?, ?)`,
      [
        req.user.household_id,
        `Mom logged expense of ₹${amount} for "${description}".`,
        newId,
        now
      ]
    );

    // Budget threshold check
    const budgetStatus = checkBudgetAlerts(req.user.household_id, date);

    const createdItem = {
      id: newId,
      household_id: req.user.household_id,
      user_id: req.user.id,
      amount: parseFloat(amount),
      date,
      time: entryTime,
      category: category.trim(),
      payment_mode,
      description: description.trim(),
      receipt_url: receiptUrl,
      receipt_filename: savedFilename,
      notes: notes ? notes.trim() : null,
      created_at: now,
      updated_at: now,
      added_by_name: req.user.full_name,
      added_by_role: req.user.role
    };

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'EXPENSE_ADDED', {
      ...createdItem,
      budget_status: budgetStatus
    });

    return res.status(201).json({
      success: true,
      message: 'Expense record saved successfully!',
      id: newId,
      data: createdItem,
      receipt_url: receiptUrl,
      budget_status: budgetStatus
    });
  } catch (error) {
    console.error('Error adding expense:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/expenses/:id
 * Edit existing expense – Strictly Mom, and only records she created in this household
 */
router.put('/:id', requireMom, (req, res) => {
  try {
    const { id } = req.params;
    const existing = queryOne(
      'SELECT * FROM expenses WHERE id = ? AND household_id = ?',
      [id, req.user.household_id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense record not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: You can only edit your own expense records.'
      });
    }

    const {
      amount,
      date,
      time,
      category,
      payment_mode,
      description,
      notes,
      receipt_data,
      receipt_filename,
      remove_receipt
    } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
    }

    let receiptUrl = existing.receipt_url;
    let savedFilename = existing.receipt_filename;

    if (remove_receipt) {
      receiptUrl = null;
      savedFilename = null;
    } else if (receipt_data) {
      try {
        const uploadResult = saveBase64Receipt(receipt_data, receipt_filename);
        receiptUrl = uploadResult.receipt_url;
        savedFilename = uploadResult.receipt_filename;
      } catch (uploadErr) {
        return res.status(400).json({ success: false, message: uploadErr.message });
      }
    }

    const now = new Date().toISOString();

    execute(
      `UPDATE expenses
       SET amount = ?, date = ?, time = ?, category = ?, payment_mode = ?, description = ?, 
           receipt_url = ?, receipt_filename = ?, notes = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
      [
        parseFloat(amount),
        date || existing.date,
        time || existing.time,
        category ? category.trim() : existing.category,
        payment_mode || existing.payment_mode,
        description ? description.trim() : existing.description,
        receiptUrl,
        savedFilename,
        notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
        now,
        id,
        req.user.household_id
      ]
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'UPDATE_EXPENSE', 'expenses', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        id,
        `Updated expense record #${id} to ₹${amount}`,
        now
      ]
    );

    const budgetStatus = checkBudgetAlerts(req.user.household_id, date || existing.date);

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'EXPENSE_UPDATED', {
      id: Number(id),
      amount: parseFloat(amount),
      description: description || existing.description,
      budget_status: budgetStatus
    });

    return res.json({
      success: true,
      message: 'Expense record updated successfully!',
      budget_status: budgetStatus
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/expenses/:id
 * Delete expense record – Strictly Mom, and only records she created in this household
 */
router.delete('/:id', requireMom, (req, res) => {
  try {
    const { id } = req.params;
    const existing = queryOne(
      'SELECT * FROM expenses WHERE id = ? AND household_id = ?',
      [id, req.user.household_id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense record not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: You can only delete your own expense records.'
      });
    }

    execute('DELETE FROM expenses WHERE id = ? AND household_id = ?', [id, req.user.household_id]);

    const now = new Date().toISOString();
    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'DELETE_EXPENSE', 'expenses', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        id,
        `Deleted expense record #${id} (₹${existing.amount} - ${existing.description})`,
        now
      ]
    );

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'EXPENSE_DELETED', { id: Number(id) });

    return res.json({
      success: true,
      message: 'Expense record removed successfully.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
