/**
 * GharKhata – Authentication & Role Verification Middleware
 * Enforces server-side permissions and household isolation.
 */

const { verifyToken } = require('../auth');
const { queryOne } = require('../database');

/**
 * Require valid authentication token
 */
function authenticateUser(req, res, next) {
  let token = null;

  const authHeader = req.headers['authorization'];
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

  // Load user from database to ensure current state and household integrity
  const user = queryOne(
    `SELECT u.id, u.household_id, u.full_name, u.phone, u.email, u.role, 
            h.name as household_name, h.monthly_budget, h.currency
     FROM users u
     JOIN households h ON u.household_id = h.id
     WHERE u.id = ?`,
    [decoded.userId]
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'User account not found or removed.'
    });
  }

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

