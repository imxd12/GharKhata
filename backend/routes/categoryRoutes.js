/**
 * GharKhata – Category Management Routes
 * Default categories + custom household categories.
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

router.use(authenticateUser);

/**
 * GET /api/categories
 * Retrieve categories available for this household
 */
router.get('/', (req, res) => {
  try {
    const { type } = req.query; // 'income', 'expense', or undefined
    let query = `
      SELECT id, name, type, icon, is_custom, household_id
      FROM categories
      WHERE (household_id IS NULL OR household_id = ?)
    `;
    const params = [req.user.household_id];

    if (type) {
      query += ` AND (type = ? OR type = 'both')`;
      params.push(type);
    }

    query += ` ORDER BY is_custom ASC, name ASC`;

    const categories = queryAll(query, params);

    return res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/categories
 * Create custom category for the household
 */
router.post('/', (req, res) => {
  try {
    const { name, type = 'expense', icon = 'tag' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanName = name.trim();
    const cleanType = (type === 'income' || type === 'both') ? type : 'expense';

    // Check if category name already exists for this household or in defaults
    const existing = queryOne(
      `SELECT id FROM categories 
       WHERE LOWER(name) = LOWER(?) AND (household_id IS NULL OR household_id = ?) AND type = ?`,
      [cleanName, req.user.household_id, cleanType]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Category "${cleanName}" already exists for ${cleanType}.`
      });
    }

    const now = new Date().toISOString();
    const result = execute(
      `INSERT INTO categories (household_id, name, type, icon, is_custom, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [req.user.household_id, cleanName, cleanType, icon, now]
    );

    return res.status(201).json({
      success: true,
      message: 'Custom category added successfully!',
      data: {
        id: Number(result.lastInsertRowid),
        name: cleanName,
        type: cleanType,
        icon,
        is_custom: 1
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/categories/:id
 * Delete a custom category (cannot delete system default categories)
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const category = queryOne(
      'SELECT * FROM categories WHERE id = ? AND household_id = ?',
      [id, req.user.household_id]
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Custom category not found or is a protected system default category.'
      });
    }

    execute('DELETE FROM categories WHERE id = ? AND household_id = ?', [id, req.user.household_id]);

    return res.json({
      success: true,
      message: 'Custom category removed.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
