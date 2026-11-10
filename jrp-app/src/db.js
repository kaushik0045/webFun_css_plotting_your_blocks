// Database setup: one SQLite file holds every table.
// DATA_DIR is where the database and uploaded files live (a persistent disk in production).
const path = require('path');
const fs = require('fs');
// Node's built-in SQLite: nothing to compile, works on any computer with Node.js 22.13 or newer.
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'jrp.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Runs several changes as one unit: either all of them are saved, or none.
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')) DEFAULT 'staff',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL CHECK (type IN ('buyer','seller','both')),
  name              TEXT NOT NULL,
  phone             TEXT,
  phone_digits      TEXT,
  email             TEXT,
  mailing_address   TEXT,
  assigned_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  address    TEXT NOT NULL,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Comments are never edited, so the history stays trustworthy.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Automatic audit trail: who did what, and when.
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- "Call this person on <date>" reminders. Each belongs to one agent.
CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at     TEXT NOT NULL,
  note       TEXT,
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, done_at, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_client ON reminders(client_id);

-- Office chat. channel = 'announce' (admins post, everyone reads), 'team' (everyone),
-- or 'dm:<lowId>-<highId>' (private between two employees).
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL,
  sender_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);

-- How far each person has read in each conversation (for unread badges and "Seen by").
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_name   ON clients(name);
CREATE INDEX IF NOT EXISTS idx_props_client   ON properties(client_id);
CREATE INDEX IF NOT EXISTS idx_comments_client ON comments(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_files_client   ON files(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_client ON activity(client_id, created_at);
`);

// Upgrades for databases created by older versions: comments, files and history
// can now belong to one specific property as well as to the client.
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
for (const t of ['comments', 'files', 'activity']) {
  addColumn(t, 'property_id', 'INTEGER REFERENCES properties(id) ON DELETE SET NULL');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_property ON ${t}(property_id)`);
}
// Answers to the buyer / seller questions (see src/questions.js), stored as JSON.
addColumn('clients', 'details', "TEXT NOT NULL DEFAULT '{}'");
addColumn('properties', 'details', "TEXT NOT NULL DEFAULT '{}'");
// Employee directory details.
addColumn('users', 'phone', 'TEXT');
addColumn('users', 'title', 'TEXT');
addColumn('users', 'last_login_at', 'TEXT');

// Secret per-reminder key, so the calendar file opens even where the login cookie isn't shared (iPhone home-screen apps).
addColumn('reminders', 'cal_key', 'TEXT');

function logActivity(clientId, userId, action, detail, propertyId = null) {
  db.prepare('INSERT INTO activity (client_id, user_id, action, detail, property_id) VALUES (?,?,?,?,?)')
    .run(clientId, userId, action, detail || null, propertyId);
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, logActivity };
