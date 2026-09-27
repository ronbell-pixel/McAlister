// SQLite database: one file per company. Money is stored in cents, dates as YYYY-MM-DD.
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','owner','user')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

-- A spot type is a pricing tier (e.g. "Indoor up to 24 ft").
CREATE TABLE IF NOT EXISTS spot_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  monthly_cents INTEGER NOT NULL DEFAULT 0,
  quarterly_cents INTEGER NOT NULL DEFAULT 0,
  yearly_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS spots (
  id INTEGER PRIMARY KEY,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  spot_type_id INTEGER REFERENCES spot_types(id) ON DELETE SET NULL,
  length_ft REAL,
  width_ft REAL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (building_id, label)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  company TEXT,
  email TEXT,
  phone TEXT,
  alt_phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','prospect')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boats (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT,
  make TEXT,
  model TEXT,
  year TEXT,
  length_ft REAL,
  registration TEXT,
  insurance_carrier TEXT,
  insurance_policy TEXT,
  insurance_expires TEXT,
  notes TEXT
);

-- A contract = a customer renting a spot at a rate on a billing cycle.
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  spot_id INTEGER REFERENCES spots(id) ON DELETE SET NULL,
  boat_id INTEGER REFERENCES boats(id) ON DELETE SET NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','quarterly','yearly')),
  rate_cents INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_bill_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  sent_at TEXT,
  sent_via TEXT,
  paid_at TEXT,
  paid_method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  occurred_on TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'incident' CHECK (category IN ('incident','equipment','facility')),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  spot_id INTEGER REFERENCES spots(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notes and attachments hang off any record: customer, spot, incident.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notes_entity ON notes(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  caption TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS attach_entity ON attachments(entity_type, entity_id);

-- Activity feed + communication log.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  customer_id INTEGER,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_customer ON activity(customer_id);
`;

// Phase 2 tables. Safe to run on an existing database.
const SCHEMA_2 = `
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  boat_length_ft REAL,
  spot_type_id INTEGER REFERENCES spot_types(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  wanted_by TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','placed','removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- A rental agreement sent for e-signature. body is frozen at send time.
CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','signed','void')),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_via TEXT,
  expires_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  signer_name TEXT,
  signature_png TEXT,
  signer_ip TEXT,
  signer_ua TEXT,
  body_sha256 TEXT,
  attachment_id INTEGER,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS agreements_contract ON agreements(contract_id);

-- One row per reminder sent, so nothing is sent twice.
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_key TEXT NOT NULL,
  customer_id INTEGER,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reminder_ref ON reminder_log(kind, ref_key);
`;

function addColumn(db, table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

function migrate(db) {
  db.exec(SCHEMA_2);
  addColumn(db, 'buildings', 'location_id', 'INTEGER REFERENCES locations(id) ON DELETE SET NULL');
  addColumn(db, 'customers', 'sms_ok', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'customers', 'reminders_ok', 'INTEGER NOT NULL DEFAULT 1');
}

// Company settings editable from the app. Seeded from company.json on first run.
const SETTING_KEYS = [
  'name', 'tagline', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website',
  'brandColor', 'invoicePrefix', 'paymentTermsDays', 'invoiceFooter', 'billingLeadDays',
  'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom',
  'stripeEnabled', 'stripePublishableKey', 'stripeSecretKey',
  // Phase 2
  'publicUrl', 'timezone', 'agreementTitle', 'agreementTemplate',
  'remindersEnabled', 'reminderDueDays', 'reminderOverdueDays', 'reminderOverdueRepeatDays', 'reminderOverdueMax',
  'reminderInsuranceDays', 'reminderEndingDays', 'reminderHour',
  'smsEnabled', 'twilioSid', 'twilioToken', 'twilioFrom',
];

// Defaults for Phase 2 settings (only written if missing).
const PHASE2_DEFAULTS = {
  timezone: 'America/Chicago',
  remindersEnabled: 'false',
  reminderDueDays: '3',
  reminderOverdueDays: '3',
  reminderOverdueRepeatDays: '7',
  reminderOverdueMax: '3',
  reminderInsuranceDays: '30',
  reminderEndingDays: '30',
  reminderHour: '9',
  smsEnabled: 'false',
};

function openDb(file, defaults) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);

  const has = db.prepare('SELECT 1 FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [k, v] of Object.entries(defaults)) {
      if (k === 'invoiceStartNumber') continue;
      if (!has.get(k)) put.run(k, String(v));
    }
    if (!has.get('nextInvoiceNumber')) put.run('nextInvoiceNumber', String(defaults.invoiceStartNumber || 1001));
    if (!has.get('stripeEnabled')) put.run('stripeEnabled', 'false');
    for (const [k, v] of Object.entries(PHASE2_DEFAULTS)) if (!has.get(k)) put.run(k, v);
    if (!has.get('agreementTemplate')) {
      const { DEFAULT_TITLE, DEFAULT_TEMPLATE } = require('./agreement');
      if (!has.get('agreementTitle')) put.run('agreementTitle', DEFAULT_TITLE);
      put.run('agreementTemplate', DEFAULT_TEMPLATE);
    }
  });
  seed();
  return db;
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function logActivity(db, kind, message, { customerId = null, userId = null } = {}) {
  db.prepare('INSERT INTO activity (kind, message, customer_id, user_id) VALUES (?, ?, ?, ?)')
    .run(kind, message, customerId, userId);
}

module.exports = { openDb, getSettings, setSetting, logActivity, SETTING_KEYS };
