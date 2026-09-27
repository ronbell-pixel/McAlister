// Billing math and invoice generation.
const { getSettings, setSetting, logActivity } = require('./db');

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

function today() {
  const d = new Date();
  return fmt(d);
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

// Adds months, clamping to the end of the month (Jan 31 + 1 month = Feb 28/29).
function addMonths(s, n) {
  const d = parse(s);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return fmt(t);
}

function periodFor(startDate, cycle) {
  const end = addDays(addMonths(startDate, CYCLE_MONTHS[cycle]), -1);
  return { start: startDate, end };
}

function nextInvoiceNumber(db) {
  const s = getSettings(db);
  const n = parseInt(s.nextInvoiceNumber || '1001', 10);
  setSetting(db, 'nextInvoiceNumber', n + 1);
  return `${s.invoicePrefix || ''}${n}`;
}

function recalcTotal(db, invoiceId) {
  const { total } = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM invoice_items WHERE invoice_id = ?').get(invoiceId);
  db.prepare('UPDATE invoices SET total_cents = ? WHERE id = ?').run(total, invoiceId);
  return total;
}

const CYCLE_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

// Creates one invoice for a contract's next billing period and advances the contract.
function invoiceContract(db, contract, { userId } = {}) {
  const s = getSettings(db);
  const terms = parseInt(s.paymentTermsDays || '15', 10);
  const period = periodFor(contract.next_bill_date, contract.billing_cycle);
  const spot = contract.spot_id
    ? db.prepare(`SELECT s.label, b.name AS building FROM spots s JOIN buildings b ON b.id = s.building_id WHERE s.id = ?`).get(contract.spot_id)
    : null;
  const boat = contract.boat_id ? db.prepare('SELECT name, make, model FROM boats WHERE id = ?').get(contract.boat_id) : null;

  const issue = today();
  // Due on the later of (issue + terms) and the period start, so advance invoices aren't due early.
  const due = [addDays(issue, terms), period.start].sort().pop();
  const number = nextInvoiceNumber(db);

  const info = db.prepare(`INSERT INTO invoices (number, customer_id, contract_id, issue_date, due_date, period_start, period_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`).run(number, contract.customer_id, contract.id, issue, due, period.start, period.end);
  const invoiceId = info.lastInsertRowid;

  const parts = [`${CYCLE_LABEL[contract.billing_cycle]} storage`];
  if (spot) parts.push(`${spot.building} — Spot ${spot.label}`);
  if (boat) parts.push([boat.name, boat.make, boat.model].filter(Boolean).join(' '));
  const us = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  const desc = `${parts.join(' · ')} (${us(period.start)} – ${us(period.end)})`;
  db.prepare('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, amount_cents) VALUES (?, ?, 1, ?, ?)')
    .run(invoiceId, desc, contract.rate_cents, contract.rate_cents);
  recalcTotal(db, invoiceId);

  db.prepare('UPDATE contracts SET next_bill_date = ? WHERE id = ?').run(addDays(period.end, 1), contract.id);
  logActivity(db, 'invoice', `Invoice ${number} created`, { customerId: contract.customer_id, userId });
  return invoiceId;
}

// Invoices every active contract whose next bill date falls on/before (today + lead days).
// Loops so a contract that is several periods behind catches up.
function runBilling(db, { throughDate, userId } = {}) {
  const s = getSettings(db);
  const through = throughDate || addDays(today(), parseInt(s.billingLeadDays || '10', 10));
  const created = [];
  const tx = db.transaction(() => {
    const due = db.prepare(`SELECT * FROM contracts WHERE status = 'active' AND next_bill_date <= ?
      AND (end_date IS NULL OR end_date = '' OR next_bill_date <= end_date)`);
    for (let guard = 0; guard < 60; guard++) {
      const batch = due.all(through);
      if (!batch.length) break;
      for (const c of batch) created.push(invoiceContract(db, c, { userId }));
    }
  });
  tx();
  return { through, created };
}

function defaultRate(db, spotId, cycle) {
  if (!spotId) return 0;
  const row = db.prepare(`SELECT t.monthly_cents, t.quarterly_cents, t.yearly_cents FROM spots s
    LEFT JOIN spot_types t ON t.id = s.spot_type_id WHERE s.id = ?`).get(spotId);
  if (!row) return 0;
  return row[`${cycle}_cents`] || 0;
}

module.exports = { today, addDays, addMonths, periodFor, runBilling, invoiceContract, recalcTotal, nextInvoiceNumber, defaultRate, CYCLE_MONTHS };
