// Excel / CSV import of existing customer records.
const ExcelJS = require('exceljs');
const path = require('path');
const { today, addMonths, CYCLE_MONTHS } = require('./billing');
const { logActivity } = require('./db');

// Every field the importer understands, with header words it recognizes automatically.
const FIELDS = [
  { key: 'full_name', label: 'Full name (splits into first/last)', match: ['name', 'full name', 'customer', 'customer name', 'owner', 'owner name'] },
  { key: 'first_name', label: 'First name', match: ['first', 'first name', 'firstname', 'fname'] },
  { key: 'last_name', label: 'Last name', match: ['last', 'last name', 'lastname', 'lname', 'surname'] },
  { key: 'company', label: 'Company', match: ['company', 'business', 'organization'] },
  { key: 'email', label: 'Email', match: ['email', 'e mail', 'email address', 'e mail address'] },
  { key: 'phone', label: 'Phone', match: ['phone', 'cell', 'mobile', 'phone number', 'telephone', 'primary phone'] },
  { key: 'alt_phone', label: 'Alt phone', match: ['alt phone', 'home phone', 'work phone', 'phone 2', 'secondary phone'] },
  { key: 'address', label: 'Street address', match: ['address', 'street', 'street address', 'address 1', 'address1', 'mailing address'] },
  { key: 'city', label: 'City', match: ['city', 'town'] },
  { key: 'state', label: 'State', match: ['state', 'st', 'province'] },
  { key: 'zip', label: 'ZIP', match: ['zip', 'zip code', 'zipcode', 'postal', 'postal code'] },
  { key: 'emergency_name', label: 'Emergency contact', match: ['emergency contact', 'emergency name'] },
  { key: 'emergency_phone', label: 'Emergency phone', match: ['emergency phone'] },
  { key: 'status', label: 'Status (active/inactive/prospect)', match: ['status'] },
  { key: 'notes', label: 'Notes', match: ['notes', 'note', 'comments', 'comment', 'memo'] },
  { key: 'boat_name', label: 'Boat name', match: ['boat name', 'vessel name', 'boat'] },
  { key: 'boat_make', label: 'Boat make', match: ['make', 'boat make', 'manufacturer'] },
  { key: 'boat_model', label: 'Boat model', match: ['model', 'boat model'] },
  { key: 'boat_year', label: 'Boat year', match: ['year', 'boat year', 'model year'] },
  { key: 'boat_length', label: 'Boat length (ft)', match: ['length', 'boat length', 'length ft', 'loa', 'size'] },
  { key: 'registration', label: 'Registration #', match: ['registration', 'reg', 'reg #', 'registration #', 'hull id', 'hin', 'vin'] },
  { key: 'insurance_carrier', label: 'Insurance carrier', match: ['insurance', 'insurance carrier', 'insurer', 'insurance company'] },
  { key: 'insurance_policy', label: 'Insurance policy #', match: ['policy', 'policy #', 'policy number', 'insurance policy'] },
  { key: 'insurance_expires', label: 'Insurance expires', match: ['insurance expires', 'insurance expiration', 'policy expires'] },
  { key: 'building', label: 'Building', match: ['building', 'bldg', 'lot', 'location', 'barn'] },
  { key: 'spot', label: 'Spot / unit #', match: ['spot', 'unit', 'space', 'slip', 'spot #', 'unit #', 'space #', 'stall'] },
  { key: 'billing_cycle', label: 'Billing cycle (monthly/quarterly/yearly)', match: ['billing', 'cycle', 'billing cycle', 'frequency', 'term'] },
  { key: 'rate', label: 'Rate ($ per cycle)', match: ['rate', 'price', 'rent', 'amount', 'fee', 'monthly rate'] },
  { key: 'start_date', label: 'Start date', match: ['start', 'start date', 'move in', 'move-in', 'since', 'date in'] },
  { key: 'next_bill_date', label: 'Next bill date', match: ['next bill', 'next bill date', 'next due', 'due date', 'renewal', 'renewal date'] },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    // Excel dates arrive as UTC midnight.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result);
    return '';
  }
  return String(v).trim();
}

async function readSheet(file, originalName) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(originalName || file).toLowerCase();
  let ws;
  if (ext === '.csv') ws = await wb.csv.readFile(file);
  else { await wb.xlsx.readFile(file); ws = wb.worksheets[0]; }
  if (!ws) throw new Error('The file has no worksheets.');

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let i = 1; i <= ws.columnCount; i++) vals.push(cellText(row.getCell(i).value));
    if (vals.some((v) => v !== '')) rows.push(vals);
  });
  if (!rows.length) throw new Error('The file is empty.');
  const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: rows.slice(1) };
}

function suggestMapping(headers) {
  const used = new Set();
  return headers.map((h) => {
    const n = norm(h);
    // exact match first, then "contains"
    let f = FIELDS.find((f) => !used.has(f.key) && f.match.includes(n));
    if (!f) f = FIELDS.find((f) => !used.has(f.key) && f.match.some((m) => m.length > 3 && n.includes(m)));
    if (f) { used.add(f.key); return f.key; }
    return '';
  });
}

function toDate(s) {
  if (!s) return '';
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

function toCents(s) {
  const n = parseFloat(String(s || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function toCycle(s) {
  const n = norm(s);
  if (!n) return 'monthly';
  if (n.startsWith('q') || n.includes('3 mo')) return 'quarterly';
  if (n.startsWith('y') || n.startsWith('a') || n.includes('12') || n.includes('season')) return 'yearly';
  return 'monthly';
}

// Next period start on or after today, stepping from the contract start, so importing
// an old contract does not create years of catch-up invoices.
function nextBillFrom(start, cycle) {
  const t = today();
  let d = start || t;
  for (let i = 0; d < t && i < 600; i++) d = addMonths(start, CYCLE_MONTHS[cycle] * (i + 1));
  return d;
}

function commitImport(db, { headers, rows }, mapping, { userId }) {
  const idx = {};
  mapping.forEach((k, i) => { if (k) idx[k] = i; });
  const get = (row, k) => (idx[k] != null ? (row[idx[k]] || '').trim() : '');

  const result = { created: 0, skipped: [], contracts: 0, buildingsCreated: 0, spotsCreated: 0 };
  const findEmail = db.prepare('SELECT id FROM customers WHERE email = ? COLLATE NOCASE');
  const insCust = db.prepare(`INSERT INTO customers (first_name, last_name, company, email, phone, alt_phone, address, city, state, zip, emergency_name, emergency_phone, status)
    VALUES (@first_name, @last_name, @company, @email, @phone, @alt_phone, @address, @city, @state, @zip, @emergency_name, @emergency_phone, @status)`);
  const insBoat = db.prepare(`INSERT INTO boats (customer_id, name, make, model, year, length_ft, registration, insurance_carrier, insurance_policy, insurance_expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insNote = db.prepare(`INSERT INTO notes (entity_type, entity_id, body, author_id) VALUES ('customer', ?, ?, ?)`);
  const findBldg = db.prepare('SELECT id FROM buildings WHERE name = ? COLLATE NOCASE');
  const insBldg = db.prepare('INSERT INTO buildings (name) VALUES (?)');
  const findSpot = db.prepare('SELECT id FROM spots WHERE building_id = ? AND label = ? COLLATE NOCASE');
  const insSpot = db.prepare('INSERT INTO spots (building_id, label) VALUES (?, ?)');
  const insContract = db.prepare(`INSERT INTO contracts (customer_id, spot_id, boat_id, billing_cycle, rate_cents, start_date, next_bill_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`);
  const spotTaken = db.prepare(`SELECT 1 FROM contracts WHERE spot_id = ? AND status = 'active'`);

  const tx = db.transaction(() => {
    rows.forEach((row, r) => {
      const line = r + 2; // spreadsheet row number (header is row 1)
      let first = get(row, 'first_name');
      let last = get(row, 'last_name');
      const full = get(row, 'full_name');
      if (full && !first && !last) {
        if (full.includes(',')) { [last, first] = full.split(',').map((x) => x.trim()); }
        else { const parts = full.split(/\s+/); last = parts.length > 1 ? parts.pop() : ''; first = parts.join(' '); }
      }
      const company = get(row, 'company');
      if (!first && !last && !company) { result.skipped.push({ row: line, reason: 'No name' }); return; }
      const email = get(row, 'email');
      if (email && findEmail.get(email)) { result.skipped.push({ row: line, reason: `Already have a customer with ${email}` }); return; }

      let status = norm(get(row, 'status'));
      if (!['active', 'inactive', 'prospect'].includes(status)) status = 'active';
      const cid = insCust.run({
        first_name: first, last_name: last, company, email,
        phone: get(row, 'phone'), alt_phone: get(row, 'alt_phone'), address: get(row, 'address'),
        city: get(row, 'city'), state: get(row, 'state'), zip: get(row, 'zip'),
        emergency_name: get(row, 'emergency_name'), emergency_phone: get(row, 'emergency_phone'), status,
      }).lastInsertRowid;
      result.created++;

      let boatId = null;
      const boatFields = ['boat_name', 'boat_make', 'boat_model', 'boat_year', 'boat_length', 'registration', 'insurance_carrier'];
      if (boatFields.some((k) => get(row, k))) {
        const len = parseFloat(get(row, 'boat_length'));
        boatId = insBoat.run(cid, get(row, 'boat_name'), get(row, 'boat_make'), get(row, 'boat_model'), get(row, 'boat_year'),
          Number.isFinite(len) ? len : null, get(row, 'registration'), get(row, 'insurance_carrier'),
          get(row, 'insurance_policy'), toDate(get(row, 'insurance_expires'))).lastInsertRowid;
      }
      if (get(row, 'notes')) insNote.run(cid, get(row, 'notes'), userId);

      const spotLabel = get(row, 'spot');
      const rate = toCents(get(row, 'rate'));
      if (spotLabel || rate) {
        let spotId = null;
        if (spotLabel) {
          const bName = get(row, 'building') || 'Main';
          let b = findBldg.get(bName);
          if (!b) { b = { id: insBldg.run(bName).lastInsertRowid }; result.buildingsCreated++; }
          let s = findSpot.get(b.id, spotLabel);
          if (!s) { s = { id: insSpot.run(b.id, spotLabel).lastInsertRowid }; result.spotsCreated++; }
          if (spotTaken.get(s.id)) result.skipped.push({ row: line, reason: `Customer added, but spot ${spotLabel} was already rented — assign manually` });
          else spotId = s.id;
        }
        if (spotId || !spotLabel) {
          const cycle = toCycle(get(row, 'billing_cycle'));
          const start = toDate(get(row, 'start_date')) || today();
          const next = toDate(get(row, 'next_bill_date')) || nextBillFrom(start, cycle);
          insContract.run(cid, spotId, boatId, cycle, rate || 0, start, next);
          result.contracts++;
        }
      }
    });
    logActivity(db, 'import', `Imported ${result.created} customers from spreadsheet`, { userId });
  });
  tx();
  return result;
}

async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Customers');
  const cols = ['First Name', 'Last Name', 'Company', 'Email', 'Phone', 'Address', 'City', 'State', 'Zip',
    'Emergency Contact', 'Emergency Phone', 'Boat Name', 'Make', 'Model', 'Year', 'Length', 'Registration',
    'Insurance Carrier', 'Policy Number', 'Insurance Expires', 'Building', 'Spot', 'Billing Cycle', 'Rate', 'Start Date', 'Next Bill Date', 'Notes'];
  ws.addRow(cols);
  ws.addRow(['Jane', 'Doe', '', 'jane@example.com', '555-123-4567', '12 Lake Rd', 'Springfield', 'MO', '65801',
    'John Doe', '555-987-6543', 'Sea Breeze', 'Bayliner', 'VR5', '2019', 21, 'MO1234AB', 'Progressive', 'P-99881', '2027-04-30',
    'Building A', 'A-12', 'Monthly', 125, '2025-05-01', '', 'Winterized by owner']);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 16; });
  return wb.xlsx.writeBuffer();
}

module.exports = { FIELDS, readSheet, suggestMapping, commitImport, templateWorkbook };
