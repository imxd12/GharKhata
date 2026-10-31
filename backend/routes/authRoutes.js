/**
 * GharKhata – Authentication & Household Pairing Routes
 */

const express = (() => { try { return require('express'); } catch(e) { return require('../miniExpress'); } })();
const { Router } = express;
const { queryOne, queryAll, execute } = require('../database');
const { hashPassword, verifyPassword, generateHouseholdId, createToken } = require('../auth');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

/**
 * POST /api/auth/register
 * Register as first member (creates Household ID) or second member (joins existing Household ID)
 */
router.post('/register', (req, res) => {
  try {
    const {
      full_name,
      phone,
      email,
      password,
      confirm_password,
      role,
      household_id,
      household_name
    } = req.body;

    // 1. Basic validation
    if (!full_name || !phone || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields (Name, Phone, Email, Password, Role).'
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Password and Confirm Password do not match.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    if (role !== 'Dad' && role !== 'Mom') {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be either "Dad" or "Mom".'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // 2. Check if email is already in use across the system
    const existingUser = queryOne('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in.'
      });
    }

    let targetHouseholdId = household_id ? household_id.trim().toUpperCase() : null;
    const now = new Date().toISOString();

    // 3. Handle Household Creation vs Joining
    if (targetHouseholdId) {
      // Joining an existing household
      const household = queryOne('SELECT * FROM households WHERE id = ?', [targetHouseholdId]);
      if (!household) {
        return res.status(404).json({
          success: false,
          message: `Household ID "${targetHouseholdId}" not found. Please verify the code with your family member.`
        });
      }

      // Check existing members in this household
      const existingMembers = queryAll('SELECT role, full_name FROM users WHERE household_id = ?', [targetHouseholdId]);

      if (existingMembers.length >= 2) {
        return res.status(400).json({
          success: false,
          message: 'This household already has both Dad and Mom registered. A household cannot have more than two members.'
        });
      }

      // Check if duplicate role
      const roleExists = existingMembers.some(m => m.role === role);
      if (roleExists) {
        const partnerRole = role === 'Dad' ? 'Mom' : 'Dad';
        return res.status(400).json({
          success: false,
          message: `This household already has a registered ${role}. Please register as ${partnerRole} or check your Household ID.`
        });
      }
    } else {
      // Creating a new household for the first family member
      let uniqueId = generateHouseholdId();
      while (queryOne('SELECT id FROM households WHERE id = ?', [uniqueId])) {
        uniqueId = generateHouseholdId();
      }
      targetHouseholdId = uniqueId;

      const familyName = household_name && household_name.trim() 
        ? household_name.trim() 
        : `${full_name.trim()}'s Household`;

      execute(
        `INSERT INTO households (id, name, monthly_budget, currency, created_at, updated_at)
         VALUES (?, ?, 50000.00, 'INR', ?, ?)`,
        [targetHouseholdId, familyName, now, now]
      );
    }

    // 4. Hash password
    const { salt, hash } = hashPassword(password);

    // 5. Insert new user
    const insertRes = execute(
      `INSERT INTO users (household_id, full_name, phone, email, password_hash, salt, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [targetHouseholdId, full_name.trim(), cleanPhone, cleanEmail, hash, salt, role, now, now]
    );

    const userId = Number(insertRes.lastInsertRowid);

    // 6. Fetch complete user and household profile
    const user = queryOne(
      `SELECT u.id, u.household_id, u.full_name, u.phone, u.email, u.role, u.created_at,
              h.name as household_name, h.monthly_budget, h.currency
       FROM users u
       JOIN households h ON u.household_id = h.id
       WHERE u.id = ?`,
      [userId]
    );

    // Log welcome notification
    execute(
      `INSERT INTO notifications (household_id, user_id, type, title, message, created_at)
       VALUES (?, ?, 'system', 'Welcome to GharKhata', ?, ?)`,
      [
        targetHouseholdId,
        userId,
        `Welcome ${full_name}! Your household ID is ${targetHouseholdId}. Share this code with ${role === 'Dad' ? 'Mom' : 'Dad'} to connect.`,
        now
      ]
    );

    // 7. Issue session token
    const token = createToken({ userId: user.id, householdId: user.household_id, role: user.role });

    return res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token,
      user
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete registration: ' + error.message
    });
  }
});

/**
 * POST /api/auth/login
 * User login with email and password
 */
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email address and password.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = queryOne('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const isMatch = verifyPassword(password, user.salt, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const household = queryOne('SELECT * FROM households WHERE id = ?', [user.household_id]);

    const token = createToken({
      userId: user.id,
      householdId: user.household_id,
      role: user.role
    });

    const safeUser = {
      id: user.id,
      household_id: user.household_id,
      full_name: user.full_name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      household_name: household ? household.name : 'My Household',
      monthly_budget: household ? household.monthly_budget : 50000,
      currency: household ? household.currency : 'INR'
    };

    return res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: safeUser
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login: ' + error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current session profile and partner information
 */
router.get('/me', authenticateUser, (req, res) => {
  try {
    // Find partner in the same household
    const partner = queryOne(
      `SELECT id, full_name, role, phone, email, created_at
       FROM users
       WHERE household_id = ? AND id != ?`,
      [req.user.household_id, req.user.id]
    );

    return res.json({
      success: true,
      user: req.user,
      partner: partner || null
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for current logged in user
 */
router.post('/change-password', authenticateUser, (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both current and new password.'
      });
    }

    if (new_password !== confirm_new_password) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation do not match.'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.'
      });
    }

    // Verify current password
    const user = queryOne('SELECT password_hash, salt FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(current_password, user.salt, user.password_hash)) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect current password.'
      });
    }

    const { salt, hash } = hashPassword(new_password);
    const now = new Date().toISOString();

    execute(
      'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
      [hash, salt, now, req.user.id]
    );

    return res.json({
      success: true,
      message: 'Password changed successfully!'
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
