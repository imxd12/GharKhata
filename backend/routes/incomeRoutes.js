/**
 * GharKhata – Income Management Routes
 * Managed exclusively by Dad. Mom can view all household income.
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser, requireDad } = require('../middleware/authMiddleware');
const { broadcastEvent } = require('../syncBroadcaster');

const router = Router();

// All income routes require authentication
router.use(authenticateUser);

/**
 * GET /api/income
 * Retrieve all income records for the household (viewable by both Dad and Mom)
 */
router.get('/', (req, res) => {
  try {
    const { search, category, payment_mode, start_date, end_date } = req.query;
    let query = `
      SELECT i.*, COALESCE(u.full_name, 'Dad') as added_by_name, COALESCE(u.role, 'Dad') as added_by_role
      FROM incomes i
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.household_id = ?
    `;
    const params = [req.user.household_id];

    if (search && search.trim()) {
      query += ` AND (i.description LIKE ? OR i.notes LIKE ? OR i.category LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (category && category !== 'all') {
      query += ` AND i.category = ?`;
      params.push(category);
    }

    if (payment_mode && payment_mode !== 'all') {
      query += ` AND i.payment_mode = ?`;
      params.push(payment_mode);
    }

    if (start_date) {
      query += ` AND i.date >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND i.date <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY i.date DESC, i.time DESC, i.id DESC`;

    const records = queryAll(query, params);

    // Calculate total summary
    const summary = queryOne(
      `SELECT COUNT(*) as total_count, COALESCE(SUM(amount), 0) as total_amount
       FROM incomes
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
 * GET /api/income/:id
 * Retrieve single income record
 */
router.get('/:id', (req, res) => {
  try {
    const record = queryOne(
      `SELECT i.*, COALESCE(u.full_name, 'Dad') as added_by_name, COALESCE(u.role, 'Dad') as added_by_role
       FROM incomes i
       LEFT JOIN users u ON i.user_id = u.id
       WHERE i.id = ? AND i.household_id = ?`,
      [req.params.id, req.user.household_id]
    );

    if (!record) {
      return res.status(404).json({ success: false, message: 'Income record not found.' });
    }

    return res.json({ success: true, data: record });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/income
 * Add new income record – Strictly permitted for Dad only
 */
router.post('/', requireDad, (req, res) => {
  try {
    const { amount, date, time, category, payment_mode, description, notes } = req.body;

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

    const now = new Date().toISOString();
    const entryTime = time || new Date().toTimeString().substring(0, 5);

    const insertResult = execute(
      `INSERT INTO incomes (household_id, user_id, amount, date, time, category, payment_mode, description, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        parseFloat(amount),
        date,
        entryTime,
        category.trim(),
        payment_mode,
        description.trim(),
        notes ? notes.trim() : null,
        now,
        now
      ]
    );

    const newId = Number(insertResult.lastInsertRowid);

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'CREATE_INCOME', 'incomes', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        newId,
        `Added income: ₹${amount} for "${description}" (${category})`,
        now
      ]
    );

    // Send notification to Mom
    execute(
      `INSERT INTO notifications (household_id, user_id, type, title, message, reference_id, created_at)
       VALUES (?, NULL, 'income_added', 'New Income Added', ?, ?, ?)`,
      [
        req.user.household_id,
        `Dad added income of ₹${amount} for "${description}".`,
        newId,
        now
      ]
    );

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
      notes: notes ? notes.trim() : null,
      created_at: now,
      updated_at: now,
      added_by_name: req.user.full_name,
      added_by_role: req.user.role
    };

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'INCOME_ADDED', createdItem);

    return res.status(201).json({
      success: true,
      message: 'Income record saved successfully!',
      id: newId,
      data: createdItem
    });
  } catch (error) {
    console.error('Error adding income:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/income/:id
 * Edit existing income record – Strictly Dad, and only records he created in this household
 */
router.put('/:id', requireDad, (req, res) => {
  try {
    const { id } = req.params;
    const existing = queryOne(
      'SELECT * FROM incomes WHERE id = ? AND household_id = ?',
      [id, req.user.household_id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Income record not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: You can only edit your own income records.'
      });
    }

    const { amount, date, time, category, payment_mode, description, notes } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
    }

    const now = new Date().toISOString();

    execute(
      `UPDATE incomes 
       SET amount = ?, date = ?, time = ?, category = ?, payment_mode = ?, description = ?, notes = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
      [
        parseFloat(amount),
        date || existing.date,
        time || existing.time,
        category ? category.trim() : existing.category,
        payment_mode || existing.payment_mode,
        description ? description.trim() : existing.description,
        notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
        now,
        id,
        req.user.household_id
      ]
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'UPDATE_INCOME', 'incomes', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        id,
        `Updated income record #${id} to ₹${amount}`,
        now
      ]
    );

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'INCOME_UPDATED', {
      id: Number(id),
      amount: parseFloat(amount),
      description: description || existing.description
    });

    return res.json({
      success: true,
      message: 'Income record updated successfully!'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/income/:id
 * Delete income record – Strictly Dad, and only records he created in this household
 */
router.delete('/:id', requireDad, (req, res) => {
  try {
    const { id } = req.params;
    const existing = queryOne(
      'SELECT * FROM incomes WHERE id = ? AND household_id = ?',
      [id, req.user.household_id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Income record not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: You can only delete your own income records.'
      });
    }

    execute('DELETE FROM incomes WHERE id = ? AND household_id = ?', [id, req.user.household_id]);

    const now = new Date().toISOString();
    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'DELETE_INCOME', 'incomes', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        id,
        `Deleted income record #${id} (₹${existing.amount} - ${existing.description})`,
        now
      ]
    );

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'INCOME_DELETED', { id: Number(id) });

    return res.json({
      success: true,
      message: 'Income record removed successfully.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
