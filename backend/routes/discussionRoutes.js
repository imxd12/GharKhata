/**
 * GharKhata – Expense Discussion & Remarks Routes
 * Facilitates transparent discussion between Dad and Mom on individual expenses.
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser } = require('../middleware/authMiddleware');
const { broadcastEvent } = require('../syncBroadcaster');

const router = Router();

router.use(authenticateUser);

/**
 * GET /api/discussions/expense/:expenseId
 * Get conversation history for a specific expense
 */
router.get('/expense/:expenseId', (req, res) => {
  try {
    const { expenseId } = req.params;

    // Verify expense belongs to user's household
    const expense = queryOne(
      'SELECT id, amount, description, category, date FROM expenses WHERE id = ? AND household_id = ?',
      [expenseId, req.user.household_id]
    );

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    const messages = queryAll(
      `SELECT d.id, d.expense_id, d.user_id, d.sender_name, d.sender_role, d.message, d.is_resolved, d.created_at
       FROM discussions d
       WHERE d.expense_id = ? AND d.household_id = ?
       ORDER BY d.created_at ASC`,
      [expenseId, req.user.household_id]
    );

    const isResolved = messages.length > 0 && messages[messages.length - 1].is_resolved === 1;

    return res.json({
      success: true,
      expense,
      messages,
      is_resolved: isResolved
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/discussions/expense/:expenseId
 * Add a remark or question (Dad) or reply (Mom/Dad)
 */
router.post('/expense/:expenseId', (req, res) => {
  try {
    const { expenseId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message text cannot be empty.' });
    }

    // Verify expense belongs to user's household
    const expense = queryOne(
      'SELECT id, amount, description, category, date, user_id FROM expenses WHERE id = ? AND household_id = ?',
      [expenseId, req.user.household_id]
    );

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found in your household.' });
    }

    const now = new Date().toISOString();

    const insertResult = execute(
      `INSERT INTO discussions (household_id, expense_id, user_id, sender_name, sender_role, message, is_resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        req.user.household_id,
        expenseId,
        req.user.id,
        req.user.full_name,
        req.user.role,
        message.trim(),
        now
      ]
    );

    const messageId = Number(insertResult.lastInsertRowid);

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'ADD_REMARK', 'discussions', ?, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        messageId,
        `${req.user.role} commented on expense #${expenseId}: "${message.trim().substring(0, 50)}"`,
        now
      ]
    );

    // Notify partner
    const notificationTitle = req.user.role === 'Dad'
      ? `Dad inquired about ₹${expense.amount} (${expense.description})`
      : `Mom replied regarding ₹${expense.amount} (${expense.description})`;

    execute(
      `INSERT INTO notifications (household_id, user_id, type, title, message, reference_id, created_at)
       VALUES (?, NULL, 'remark_added', ?, ?, ?, ?)`,
      [
        req.user.household_id,
        notificationTitle,
        message.trim(),
        expenseId,
        now
      ]
    );

    // Real-time broadcast
    broadcastEvent(req.user.household_id, 'REMARK_ADDED', {
      id: messageId,
      expense_id: Number(expenseId),
      sender_name: req.user.full_name,
      sender_role: req.user.role,
      message: message.trim(),
      created_at: now
    });

    return res.status(201).json({
      success: true,
      message: 'Remark posted successfully.',
      data: {
        id: messageId,
        expense_id: Number(expenseId),
        sender_name: req.user.full_name,
        sender_role: req.user.role,
        message: message.trim(),
        is_resolved: 0,
        created_at: now
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PATCH /api/discussions/expense/:expenseId/resolve
 * Mark a discussion thread as resolved or reopened
 */
router.patch('/expense/:expenseId/resolve', (req, res) => {
  try {
    const { expenseId } = req.params;
    const { resolved } = req.body; // boolean or 1/0
    const isResolved = (resolved === true || resolved === 1 || resolved === 'true') ? 1 : 0;

    const expense = queryOne(
      'SELECT id, description FROM expenses WHERE id = ? AND household_id = ?',
      [expenseId, req.user.household_id]
    );

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }

    execute(
      `UPDATE discussions 
       SET is_resolved = ? 
       WHERE expense_id = ? AND household_id = ?`,
      [isResolved, expenseId, req.user.household_id]
    );

    const now = new Date().toISOString();
    const statusText = isResolved ? 'resolved' : 'reopened';

    // Broadcast
    broadcastEvent(req.user.household_id, 'DISCUSSION_STATUS_CHANGED', {
      expense_id: Number(expenseId),
      is_resolved: isResolved,
      updated_by: req.user.full_name
    });

    return res.json({
      success: true,
      message: `Discussion thread marked as ${statusText}.`,
      is_resolved: isResolved
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/discussions/active
 * Get all expenses that have open or unresolved remarks
 */
router.get('/active', (req, res) => {
  try {
    const list = queryAll(
      `SELECT e.id as expense_id, e.description, e.amount, e.date, e.category,
              COUNT(d.id) as message_count,
              MAX(d.created_at) as last_message_at,
              MIN(d.is_resolved) as has_unresolved
       FROM expenses e
       JOIN discussions d ON e.id = d.expense_id
       WHERE e.household_id = ?
       GROUP BY e.id
       ORDER BY last_message_at DESC`,
      [req.user.household_id]
    );

    return res.json({
      success: true,
      data: list
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
