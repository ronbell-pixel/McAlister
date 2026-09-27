// Late fees: added once per invoice after the grace period.
// The fee is a line on the overdue invoice, so the customer sees one updated total.
const { getSettings, logActivity } = require('./db');
const { today, addDays, recalcTotal } = require('./billing');
const { money, usDate } = require('./pdf');

function feeFor(invoice, s) {
  const amt = parseFloat(s.lateFeeAmount) || 0;
  let cents = s.lateFeeType === 'percent' ? Math.round((invoice.total_cents * amt) / 100) : Math.round(amt * 100);
  const min = Math.round((parseFloat(s.lateFeeMinimum) || 0) * 100);
  if (s.lateFeeType === 'percent' && cents < min) cents = min;
  return cents;
}

// Invoices that qualify for a late fee today.
function collect(db, s = getSettings(db)) {
  const grace = parseInt(s.lateFeeGraceDays, 10) || 0;
  return db.prepare(`SELECT i.*, TRIM(c.first_name || ' ' || c.last_name) AS customer_name FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.status = 'sent' AND i.late_fee_cents = 0 AND i.due_date <= ? ORDER BY i.due_date`)
    .all(addDays(today(), -grace))
    .map((i) => ({ ...i, fee_cents: feeFor(i, s) }))
    .filter((i) => i.fee_cents > 0);
}

function apply(db, invoiceId, cents, { userId = null } = {}) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || !['sent', 'draft'].includes(inv.status) || inv.late_fee_cents) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, amount_cents, kind) VALUES (?, ?, 1, ?, ?, 'late_fee')`)
      .run(inv.id, `Late fee — payment not received by ${usDate(inv.due_date)}`, cents, cents);
    recalcTotal(db, inv.id);
    db.prepare('UPDATE invoices SET late_fee_cents = ? WHERE id = ?').run(cents, inv.id);
  })();
  logActivity(db, 'invoice', `Late fee ${money(cents)} added to ${inv.number}`, { customerId: inv.customer_id, userId });
  return true;
}

function remove(db, invoiceId, { userId = null } = {}) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || !inv.late_fee_cents || inv.status === 'paid') return false;
  db.transaction(() => {
    db.prepare(`DELETE FROM invoice_items WHERE invoice_id = ? AND kind = 'late_fee'`).run(inv.id);
    recalcTotal(db, inv.id);
    // Keep a marker (-1) so the automatic run doesn't add it again.
    db.prepare('UPDATE invoices SET late_fee_cents = -1 WHERE id = ?').run(inv.id);
  })();
  logActivity(db, 'invoice', `Late fee waived on ${inv.number}`, { customerId: inv.customer_id, userId });
  return true;
}

function run(db, { userId = null } = {}) {
  const s = getSettings(db);
  const due = collect(db, s);
  let added = 0;
  for (const i of due) if (apply(db, i.id, i.fee_cents, { userId })) added++;
  return { added, total_cents: due.reduce((a, i) => a + i.fee_cents, 0) };
}

module.exports = { collect, apply, remove, run, feeFor };
