/**
 * GharKhata – SQLite Database Layer
 * Uses Node.js native DatabaseSync for zero external dependencies and fast performance.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const os = require('node:os');

const DB_DIR = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '..', 'database');
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(__dirname, '..', process.env.DATABASE_PATH)
  : path.join(DB_DIR, 'gharKhata.db');

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Configure SQLite pragmas
try {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
} catch (e) {
  console.warn('Pragma setup warning:', e.message);
}

/**
 * Initialize Database Schema
 */
function initDatabase() {
  // 1. Households table
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_budget REAL NOT NULL DEFAULT 50000.00,
      currency TEXT NOT NULL DEFAULT 'INR',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 2. Users table (strictly 1 Dad and 1 Mom per household enforced by unique constraint)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT CHECK(role IN ('Dad', 'Mom')) NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );
  `);

  // Unique constraint ensuring only one Dad and one Mom per household
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_household_role 
    ON users(household_id, role);
  `);

  // 3. Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('income', 'expense', 'both')) NOT NULL DEFAULT 'expense',
      icon TEXT DEFAULT 'tag',
      is_custom INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // 4. Incomes table (Managed strictly by Dad)
  db.exec(`
    CREATE TABLE IF NOT EXISTS incomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      category TEXT NOT NULL,
      payment_mode TEXT CHECK(payment_mode IN ('Cash', 'UPI', 'Bank', 'Other')) NOT NULL,
      description TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 5. Expenses table (Managed strictly by Mom)
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      category TEXT NOT NULL,
      payment_mode TEXT CHECK(payment_mode IN ('Cash', 'UPI', 'Bank', 'Other')) NOT NULL,
      description TEXT NOT NULL,
      receipt_url TEXT,
      receipt_filename TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 6. Discussions / Remarks on expenses
  db.exec(`
    CREATE TABLE IF NOT EXISTS discussions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT CHECK(sender_role IN ('Dad', 'Mom')) NOT NULL,
      message TEXT NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 7. Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      user_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      reference_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );
  `);

  // 8. Audit logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );
  `);

  // Pre-populate default categories if not already present
  seedDefaultCategories();

  console.log(' SQLite database schema initialized at:', DB_PATH);
}

function seedDefaultCategories() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM categories WHERE household_id IS NULL').get();
  if (countRow && countRow.count > 0) return;

  const defaultExpenses = [
    { name: 'Groceries', icon: 'shopping-cart' },
    { name: 'Electricity', icon: 'zap' },
    { name: 'Water', icon: 'droplet' },
    { name: 'Rent', icon: 'home' },
    { name: 'Medical', icon: 'activity' },
    { name: 'Education', icon: 'book' },
    { name: 'Transport', icon: 'truck' },
    { name: 'Food', icon: 'coffee' },
    { name: 'Shopping', icon: 'tag' },
    { name: 'Household', icon: 'box' },
    { name: 'Others', icon: 'more-horizontal' }
  ];

  const defaultIncomes = [
    { name: 'Salary', icon: 'briefcase' },
    { name: 'Business', icon: 'trending-up' },
    { name: 'Investment', icon: 'pie-chart' },
    { name: 'Rental', icon: 'key' },
    { name: 'Freelance', icon: 'laptop' },
    { name: 'Gift / Bonus', icon: 'gift' },
    { name: 'Other Income', icon: 'dollar-sign' }
  ];

  const stmt = db.prepare(`
    INSERT INTO categories (household_id, name, type, icon, is_custom, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const cat of defaultExpenses) {
    stmt.run(null, cat.name, 'expense', cat.icon, 0, now);
  }
  for (const cat of defaultIncomes) {
    stmt.run(null, cat.name, 'income', cat.icon, 0, now);
  }
}

// Helper methods
const queryOne = (sql, params = []) => {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
};

const queryAll = (sql, params = []) => {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
};

const execute = (sql, params = []) => {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
};

module.exports = {
  db,
  initDatabase,
  queryOne,
  queryAll,
  execute
};

