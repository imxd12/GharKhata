/**
 * GharKhata – Main Application Server
 * Minimal, secure backend API for SQLite operations, authentication,
 * receipt storage and real-time synchronization.
 */

const express = (() => { try { return require('express'); } catch(e) { return require('./miniExpress'); } })();
const cors = (() => { try { return require('cors'); } catch(e) { return () => (req, res, next) => next(); } })();
const path = require('node:path');
const fs = require('node:fs');

// Load environment variables if available
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  }
}

const { initDatabase, queryOne, execute } = require('./database');
const { registerClient } = require('./syncBroadcaster');
const { verifyToken } = require('./auth');
const { authenticateUser } = require('./middleware/authMiddleware');

// Route modules
const authRoutes = require('./routes/authRoutes');
const incomeRoutes = require('./routes/incomeRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const discussionRoutes = require('./routes/discussionRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const reportRoutes = require('./routes/reportRoutes');
const householdRoutes = require('./routes/householdRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');

// 1. Initialize SQLite database and tables
initDatabase();

// 2. Middleware
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// 3. Static Assets & Frontend Files
app.use('/css', express.static(path.join(ROOT_DIR, 'css')));
app.use('/js', express.static(path.join(ROOT_DIR, 'js')));
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));
app.use('/uploads', express.static(path.join(ROOT_DIR, 'uploads')));
app.use('/manifest.json', express.static(path.join(ROOT_DIR, 'manifest.json')));
app.use('/sw.js', express.static(path.join(ROOT_DIR, 'sw.js')));
const fbConfigPath = fs.existsSync(path.join(ROOT_DIR, 'firebase-config.js'))
  ? path.join(ROOT_DIR, 'firebase-config.js')
  : path.join(ROOT_DIR, 'firebase-config.example.js');
app.use('/firebase-config.js', express.static(fbConfigPath));

// 4. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/discussions', discussionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/household', householdRoutes);
app.use('/api/notifications', notificationRoutes);

/**
 * Real-Time Server-Sent Events (SSE) Stream
 * Allows instant live synchronization across devices and tabs
 */
app.get('/api/sync/events', (req, res) => {
  const token = req.query.token;
  const householdId = req.query.householdId;

  if (!householdId) {
    return res.status(400).send('Household ID is required for sync.');
  }

  // Validate token if provided
  if (token) {
    const payload = verifyToken(token);
    if (!payload || payload.householdId !== householdId) {
      return res.status(403).send('Unauthorized household sync.');
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', householdId, message: 'Real-time sync active' })}\n\n`);

  registerClient(householdId, res);
});

/**
 * Multi-Container / Serverless Auto-Restore Endpoint
 * Re-hydrates SQLite database in ephemeral serverless instances from client persistent storage.
 */
app.post('/api/sync/restore', authenticateUser, (req, res) => {
  try {
    const { incomes, expenses } = req.body || {};
    const householdId = req.user.household_id;
    let restoredIncomes = 0;
    let restoredExpenses = 0;

    if (Array.isArray(incomes)) {
      for (const inc of incomes) {
        if (!inc || !inc.amount) continue;
        const exists = queryOne(
          'SELECT id FROM incomes WHERE household_id = ? AND ((id = ? AND id IS NOT NULL) OR (description = ? AND amount = ? AND date = ?))', 
          [householdId, typeof inc.id === 'number' ? inc.id : null, inc.description, inc.amount, inc.date]
        );
        if (!exists) {
          let targetUserId = req.user.id;
          if (inc.user_id) {
            const uRow = queryOne('SELECT id FROM users WHERE id = ?', [inc.user_id]);
            if (uRow) targetUserId = uRow.id;
          }
          execute(
            `INSERT INTO incomes (id, household_id, user_id, amount, date, time, category, payment_mode, description, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              typeof inc.id === 'number' ? inc.id : null,
              householdId,
              targetUserId,
              parseFloat(inc.amount),
              inc.date,
              inc.time || '12:00',
              inc.category || 'Other Income',
              inc.payment_mode || 'Bank',
              inc.description || 'Income',
              inc.notes || null,
              inc.created_at || new Date().toISOString(),
              inc.updated_at || new Date().toISOString()
            ]
          );
          restoredIncomes++;
        }
      }
    }

    if (Array.isArray(expenses)) {
      for (const exp of expenses) {
        if (!exp || !exp.amount) continue;
        const exists = queryOne(
          'SELECT id FROM expenses WHERE household_id = ? AND ((id = ? AND id IS NOT NULL) OR (description = ? AND amount = ? AND date = ?))', 
          [householdId, typeof exp.id === 'number' ? exp.id : null, exp.description, exp.amount, exp.date]
        );
        if (!exists) {
          let targetUserId = req.user.id;
          if (exp.user_id) {
            const uRow = queryOne('SELECT id FROM users WHERE id = ?', [exp.user_id]);
            if (uRow) targetUserId = uRow.id;
          }
          execute(
            `INSERT INTO expenses (id, household_id, user_id, amount, date, time, category, payment_mode, description, receipt_url, receipt_filename, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              typeof exp.id === 'number' ? exp.id : null,
              householdId,
              targetUserId,
              parseFloat(exp.amount),
              exp.date,
              exp.time || '12:00',
              exp.category || 'Others',
              exp.payment_mode || 'UPI',
              exp.description || 'Expense',
              exp.receipt_url || null,
              exp.receipt_filename || null,
              exp.notes || null,
              exp.created_at || new Date().toISOString(),
              exp.updated_at || new Date().toISOString()
            ]
          );
          restoredExpenses++;
        }
      }
    }

    return res.json({
      success: true,
      restoredIncomes,
      restoredExpenses,
      message: `Sync completed: ${restoredIncomes} incomes and ${restoredExpenses} expenses synchronized.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    app: 'GharKhata',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 5. Serve HTML pages directly
const pages = [
  'index',
  'login',
  'register',
  'dashboard',
  'income',
  'expenses',
  'transactions',
  'analytics',
  'discussions',
  'reports',
  'profile',
  'settings'
];

pages.forEach(page => {
  const filePath = path.join(ROOT_DIR, `${page}.html`);
  app.get(`/${page}`, (req, res) => res.sendFile(filePath));
  app.get(`/${page}.html`, (req, res) => res.sendFile(filePath));
});

// Default root redirect to dashboard or login
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// 404 Fallback for unhandled routes
app.use((req, res) => {
  const reqPath = req.path || req.pathname || '';
  if (reqPath.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  }
  res.status(404).sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Start Server (if not running in serverless environment like Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` GharKhata is running at: http://localhost:${PORT}`);
    console.log(` Tagline: "Your Family. Your Money. One Khata."`);
    console.log(` Database: SQLite (Persistent) + Real-Time Sync`);
    console.log(`=================================================`);
  });
}

module.exports = app;
