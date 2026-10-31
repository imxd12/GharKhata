/**
 * GharKhata – Authentication & Role Verification Middleware
 * Enforces server-side permissions and household isolation.
 */

const crypto = require('node:crypto');
const { verifyToken, hashPassword } = require('../auth');
const { queryOne, execute } = require('../database');

/**
 * Require valid authentication token
 */
function authenticateUser(req, res, next) {
  let token = null;

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.'
    });
  }

  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please log in again.'
    });
  }

  // Load user from database using LEFT JOIN so missing household row doesn't break authentication
  let user = queryOne(
    `SELECT u.id, u.household_id, u.full_name, u.phone, u.email, u.role, 
            h.name as household_name, h.monthly_budget, h.currency
     FROM users u
     LEFT JOIN households h ON u.household_id = h.id
     WHERE u.id = ?`,
    [decoded.userId]
  );

  // If user is not yet in this local SQLite instance (e.g. serverless cold start / fresh lambda container),
  // but the token was cryptographically signed by our secret, self-heal the SQLite instance!
  if (!user) {
    const now = new Date().toISOString();
    const fallbackName = decoded.fullName || (decoded.role === 'Dad' ? 'Dad' : 'Mom');
    const fallbackEmail = decoded.email || `${decoded.role.toLowerCase()}@family.internal`;
    const fallbackPhone = decoded.phone || '';
    const householdId = decoded.householdId;

    try {
      // 1. Ensure household exists
      execute(
        `INSERT OR IGNORE INTO households (id, name, monthly_budget, currency, created_at, updated_at)
         VALUES (?, ?, 50000.00, 'INR', ?, ?)`,
        [householdId, `${fallbackName}'s Household`, now, now]
      );

      // 2. Insert user if missing (never overwrite existing credentials with a stub!)
      const dummyCreds = hashPassword(crypto.randomBytes(32).toString('hex'));
      execute(
        `INSERT OR IGNORE INTO users (id, household_id, full_name, phone, email, password_hash, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [decoded.userId, householdId, fallbackName, fallbackPhone, fallbackEmail, dummyCreds.hash, dummyCreds.salt, decoded.role, now, now]
      );

      // 3. Re-query user
      user = queryOne(
        `SELECT u.id, u.household_id, u.full_name, u.phone, u.email, u.role, 
                h.name as household_name, h.monthly_budget, h.currency
         FROM users u
         LEFT JOIN households h ON u.household_id = h.id
         WHERE u.id = ?`,
        [decoded.userId]
      );
    } catch (e) {
      console.warn('Auto-heal database notice:', e.message);
    }

    if (!user) {
      user = {
        id: decoded.userId,
        household_id: householdId,
        full_name: fallbackName,
        phone: fallbackPhone,
        email: fallbackEmail,
        role: decoded.role,
        household_name: `${fallbackName}'s Household`,
        monthly_budget: 50000,
        currency: 'INR'
      };
    }
  }

  // Ensure safe defaults
  if (!user.household_name) user.household_name = 'My Household';
  if (user.monthly_budget === null || user.monthly_budget === undefined) user.monthly_budget = 50000;
  if (!user.currency) user.currency = 'INR';

  req.user = user;
  next();
}

/**
 * Enforce Dad role for Income Management
 */
function requireDad(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (req.user.role !== 'Dad') {
    return res.status(403).json({
      success: false,
      message: 'Permission denied: Mom is the Expense Manager. Only Dad has permission to manage Income records.'
    });
  }
  next();
}

/**
 * Enforce Mom role for Expense Management
 */
function requireMom(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (req.user.role !== 'Mom') {
    return res.status(403).json({
      success: false,
      message: 'Permission denied: Dad is the Income Manager. Only Mom has permission to manage Expense records.'
    });
  }
  next();
}

module.exports = {
  authenticateUser,
  requireDad,
  requireMom
};

