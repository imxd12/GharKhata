/**
 * GharKhata – Household Management & Partner Routes
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { authenticateUser } = require('../middleware/authMiddleware');
const { broadcastEvent } = require('../syncBroadcaster');

const router = Router();

router.use(authenticateUser);

/**
 * GET /api/household
 * Get current household information and registered members
 */
router.get('/', (req, res) => {
  try {
    const household = queryOne('SELECT * FROM households WHERE id = ?', [req.user.household_id]);
    if (!household) {
      return res.status(404).json({ success: false, message: 'Household not found.' });
    }

    const members = queryAll(
      `SELECT id, full_name, phone, email, role, created_at
       FROM users
       WHERE household_id = ?
       ORDER BY role ASC`,
      [req.user.household_id]
    );

    return res.json({
      success: true,
      data: {
        household,
        members
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/household
 * Update household profile, monthly budget or currency
 */
router.put('/', (req, res) => {
  try {
    const { name, monthly_budget, currency = 'INR' } = req.body;

    const budgetVal = monthly_budget !== undefined ? parseFloat(monthly_budget) : null;
    if (budgetVal !== null && (isNaN(budgetVal) || budgetVal < 0)) {
      return res.status(400).json({ success: false, message: 'Monthly budget must be a positive number.' });
    }

    const household = queryOne('SELECT * FROM households WHERE id = ?', [req.user.household_id]);
    if (!household) {
      return res.status(404).json({ success: false, message: 'Household not found.' });
    }

    const updatedName = name && name.trim() ? name.trim() : household.name;
    const updatedBudget = budgetVal !== null ? budgetVal : household.monthly_budget;
    const now = new Date().toISOString();

    execute(
      `UPDATE households
       SET name = ?, monthly_budget = ?, currency = ?, updated_at = ?
       WHERE id = ?`,
      [updatedName, updatedBudget, currency, now, req.user.household_id]
    );

    // Audit log
    execute(
      `INSERT INTO audit_logs (household_id, user_id, user_name, user_role, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, 'UPDATE_BUDGET', 'households', NULL, ?, ?)`,
      [
        req.user.household_id,
        req.user.id,
        req.user.full_name,
        req.user.role,
        `Updated household budget to ₹${updatedBudget.toLocaleString()} (${updatedName})`,
        now
      ]
    );

    // Broadcast budget update
    broadcastEvent(req.user.household_id, 'HOUSEHOLD_UPDATED', {
      name: updatedName,
      monthly_budget: updatedBudget,
      currency
    });

    return res.json({
      success: true,
      message: 'Household settings saved successfully!',
      data: {
        id: req.user.household_id,
        name: updatedName,
        monthly_budget: updatedBudget,
        currency
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/household/partner
 * Returns partner's information specifically for WhatsApp click-to-chat integration
 */
router.get('/partner', (req, res) => {
  try {
    const partner = queryOne(
      `SELECT id, full_name, phone, role, email
       FROM users
       WHERE household_id = ? AND id != ?`,
      [req.user.household_id, req.user.id]
    );

    return res.json({
      success: true,
      partner: partner || null
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/household/backup
 * Generates full JSON backup of the household's financial data
 */
router.get('/backup', (req, res) => {
  try {
    const householdId = req.user.household_id;

    const household = queryOne('SELECT * FROM households WHERE id = ?', [householdId]);
    const members = queryAll('SELECT id, full_name, phone, email, role, created_at FROM users WHERE household_id = ?', [householdId]);
    const incomes = queryAll('SELECT * FROM incomes WHERE household_id = ?', [householdId]);
    const expenses = queryAll('SELECT * FROM expenses WHERE household_id = ?', [householdId]);
    const discussions = queryAll('SELECT * FROM discussions WHERE household_id = ?', [householdId]);
    const categories = queryAll('SELECT * FROM categories WHERE household_id = ?', [householdId]);

    const backupData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      household_id: householdId,
      household,
      members,
      categories,
      incomes,
      expenses,
      discussions
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=GharKhata_Backup_${householdId}.json`);
    return res.send(JSON.stringify(backupData, null, 2));
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
