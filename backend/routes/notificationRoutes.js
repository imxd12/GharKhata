/**
 * GharKhata – Central Notification Center Routes
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

router.use(authenticateUser);

/**
 * GET /api/notifications
 * Fetch latest notifications for the household
 */
router.get('/', (req, res) => {
  try {
    const list = queryAll(
      `SELECT * FROM notifications
       WHERE household_id = ? AND (user_id IS NULL OR user_id = ?)
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.household_id, req.user.id]
    );

    const unreadCount = queryOne(
      `SELECT COUNT(*) as count FROM notifications
       WHERE household_id = ? AND (user_id IS NULL OR user_id = ?) AND is_read = 0`,
      [req.user.household_id, req.user.id]
    ).count;

    return res.json({
      success: true,
      data: list,
      unread_count: unreadCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark single notification as read
 */
router.patch('/:id/read', (req, res) => {
  try {
    const { id } = req.params;
    execute(
      `UPDATE notifications 
       SET is_read = 1 
       WHERE id = ? AND household_id = ?`,
      [id, req.user.household_id]
    );

    return res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read for current user
 */
router.post('/mark-all-read', (req, res) => {
  try {
    execute(
      `UPDATE notifications 
       SET is_read = 1 
       WHERE household_id = ? AND (user_id IS NULL OR user_id = ?)`,
      [req.user.household_id, req.user.id]
    );

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    execute('DELETE FROM notifications WHERE id = ? AND household_id = ?', [id, req.user.household_id]);

    return res.json({ success: true, message: 'Notification removed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
