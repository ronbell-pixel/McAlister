// CRM: customers, boats, rentals (contracts) and notes.
const express = require('express');
const { requirePerm, httpError, can } = require('../lib/auth');
const { logActivity } = require('../lib/db');
const { defaultRate, today } = require('../lib/billing');
const { removeChildren } = require('../lib/cleanup');
const { locationId, SQL } = require('../lib/locations');

const CUSTOMER_FIELDS = ['first_name', 'last_name', 'company', 'email', 'phone', 'alt_phone', 'address', 'city', 'state', 'zip', 'emergency_name', 'emergency_phone', 'status', 'sms_ok', 'reminders_ok'];
const BOAT_FIELDS = ['name', 'make', 'model', 'year', 'length_ft', 'registration', 'insurance_carrier', 'insurance_policy', 'insurance_expires', 'notes'];
const NOTE_TYPES = ['customer', 'spot', 'incident'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

module.exports = ({ db, paths }) => {
  const r = express.Router();
  const displayName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || 'Customer';

  r.get('/customers', requirePerm('customers.view'), (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '');
    const where = [];
    const args = {};
    if (q) {
      where.push(`(c.first_name || ' ' || c.last_name LIKE @q OR c.company LIKE @q OR c.email LIKE @q OR c.phone LIKE @q
        OR EXISTS (SELECT 1 FROM boats b WHERE b.customer_id = c.id AND (b.name LIKE @q OR b.make LIKE @q OR b.registration LIKE @q))
        OR EXISTS (SELECT 1 FROM contracts k JOIN spots s ON s.id = k.spot_id WHERE k.customer_id = c.id AND k.status = 'active' AND s.label LIKE @q))`);
      args.q = `%${q}%`;
    }
    if (['active', 'inactive', 'prospect'].includes(status)) { where.push('c.status = @status'); args.status = status; }
    // Location filter: customers renting there, plus anyone who has never rented (so new people aren't hidden).
    const loc = locationId(req);
    if (loc) where.push(`(${SQL.customerIn('c.id', loc)} OR NOT EXISTS (SELECT 1 FROM contracts kx WHERE kx.customer_id = c.id AND kx.spot_id IS NOT NULL))`);
    const rows = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.company, c.email, c.phone, c.status,
        (SELECT GROUP_CONCAT(s.label, ', ') FROM contracts k JOIN spots s ON s.id = k.spot_id WHERE k.customer_id = c.id AND k.status = 'active') AS spots,
        (SELECT COALESCE(SUM(total_cents),0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'sent') AS balance_cents
      FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE LIMIT 500`).all(args);
    if (!can(req.user, 'invoices')) rows.forEach((x) => delete x.balance_cents);
    res.json(rows);
  });

  r.get('/customers/:id', requirePerm('customers.view'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw httpError(404, 'Customer not found.');
    const out = {
      customer: c,
      boats: db.prepare('SELECT * FROM boats WHERE customer_id = ? ORDER BY id').all(id),
      contracts: db.prepare(`SELECT k.*, s.label AS spot_label, b.name AS building, bo.name AS boat_name, bo.make AS boat_make
        FROM contracts k LEFT JOIN spots s ON s.id = k.spot_id LEFT JOIN buildings b ON b.id = s.building_id LEFT JOIN boats bo ON bo.id = k.boat_id
        WHERE k.customer_id = ? ORDER BY k.status, k.start_date DESC`).all(id),
      notes: db.prepare(`SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.entity_type = 'customer' AND n.entity_id = ? ORDER BY n.created_at DESC, n.id DESC`).all(id),
      attachments: db.prepare(`SELECT a.id, a.original_name, a.mime, a.caption, a.created_at, u.name AS uploaded_by_name FROM attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.entity_type = 'customer' AND a.entity_id = ? ORDER BY a.id DESC`).all(id),
      incidents: db.prepare(`SELECT id, title, occurred_on, status, category FROM incidents WHERE customer_id = ? ORDER BY occurred_on DESC`).all(id),
      agreements: db.prepare(`SELECT id, contract_id, title, status, sent_at, sent_via, viewed_at, signed_at, signer_name, attachment_id
        FROM agreements WHERE customer_id = ? AND status != 'void' ORDER BY id DESC`).all(id),
      waitlist: db.prepare(`SELECT id, status, created_at FROM waitlist WHERE customer_id = ? AND status IN ('waiting','offered')`).all(id),
      activity: db.prepare(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.customer_id = ? ORDER BY a.id DESC LIMIT 50`).all(id),
    };
    if (can(req.user, 'invoices')) {
      out.invoices = db.prepare(`SELECT id, number, issue_date, due_date, total_cents, status FROM invoices WHERE customer_id = ? ORDER BY issue_date DESC, id DESC`).all(id);
    } else {
      out.contracts.forEach((k) => delete k.rate_cents);
    }
    res.json(out);
  });

  const custValues = (b) => {
    const v = {};
    for (const f of CUSTOMER_FIELDS) v[f] = b[f] == null ? '' : String(b[f]).trim();
    if (!['active', 'inactive', 'prospect'].includes(v.status)) v.status = 'active';
    // Checkboxes: texting needs an explicit yes; reminders default to on.
    v.sms_ok = b.sms_ok === true || b.sms_ok === 'true' || b.sms_ok === 1 ? 1 : 0;
    v.reminders_ok = b.reminders_ok === false || b.reminders_ok === 'false' || b.reminders_ok === 0 ? 0 : 1;
    if (!v.first_name && !v.last_name && !v.company) throw httpError(400, 'Enter a name or company.');
    return v;
  };

  r.post('/customers', requirePerm('customers.edit'), (req, res) => {
    const v = custValues(req.body || {});
    const id = db.prepare(`INSERT INTO customers (${CUSTOMER_FIELDS.join(', ')}) VALUES (${CUSTOMER_FIELDS.map((f) => '@' + f).join(', ')})`).run(v).lastInsertRowid;
    logActivity(db, 'customer', `New customer: ${displayName(v)}`, { customerId: id, userId: req.user.id });
    res.json({ id });
  });

  r.put('/customers/:id', requirePerm('customers.edit'), (req, res) => {
    const v = custValues(req.body || {});
    const info = db.prepare(`UPDATE customers SET ${CUSTOMER_FIELDS.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...v, id: Number(req.params.id) });
    if (!info.changes) throw httpError(404, 'Customer not found.');
    res.json({ ok: true });
  });

  r.delete('/customers/:id', requirePerm('customers.delete'), (req, res) => {
    const active = db.prepare(`SELECT 1 FROM contracts WHERE customer_id = ? AND status = 'active'`).get(req.params.id);
    if (active) throw httpError(400, 'End this customer’s rentals first, or mark them inactive instead.');
    const id = Number(req.params.id);
    db.transaction(() => { db.prepare('DELETE FROM customers WHERE id = ?').run(id); removeChildren(db, paths.uploadsDir, 'customer', id); })();
    res.json({ ok: true });
  });

  // ---- Boats ----
  const boatValues = (b) => {
    const v = {};
    for (const f of BOAT_FIELDS) v[f] = b[f] == null || b[f] === '' ? null : String(b[f]).trim();
    if (v.length_ft != null) { const n = parseFloat(v.length_ft); v.length_ft = Number.isFinite(n) ? n : null; }
    if (v.insurance_expires && !isDate(v.insurance_expires)) v.insurance_expires = null;
    return v;
  };
  r.post('/customers/:id/boats', requirePerm('customers.edit'), (req, res) => {
    const v = boatValues(req.body || {});
    const id = db.prepare(`INSERT INTO boats (customer_id, ${BOAT_FIELDS.join(', ')}) VALUES (@customer_id, ${BOAT_FIELDS.map((f) => '@' + f).join(', ')})`)
      .run({ ...v, customer_id: Number(req.params.id) }).lastInsertRowid;
    res.json({ id });
  });
  r.put('/boats/:id', requirePerm('customers.edit'), (req, res) => {
    const v = boatValues(req.body || {});
    db.prepare(`UPDATE boats SET ${BOAT_FIELDS.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...v, id: Number(req.params.id) });
    res.json({ ok: true });
  });
  r.delete('/boats/:id', requirePerm('customers.edit'), (req, res) => {
    db.prepare('DELETE FROM boats WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- Rentals (contracts) ----
  r.get('/rate-for', requirePerm('contracts.edit'), (req, res) => {
    res.json({ rate_cents: defaultRate(db, Number(req.query.spot_id), req.query.cycle || 'monthly') });
  });

  const contractValues = (b, existingId) => {
    const cycle = b.billing_cycle;
    if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) throw httpError(400, 'Pick a billing cycle.');
    const spotId = b.spot_id ? Number(b.spot_id) : null;
    if (spotId) {
      const taken = db.prepare(`SELECT 1 FROM contracts WHERE spot_id = ? AND status = 'active' AND id != ?`).get(spotId, existingId || 0);
      if (taken) throw httpError(400, 'That spot is already rented.');
    }
    let rate = b.rate == null || b.rate === '' ? null : Math.round(parseFloat(String(b.rate).replace(/[$,]/g, '')) * 100);
    if (rate == null || !Number.isFinite(rate)) rate = defaultRate(db, spotId, cycle);
    const start = isDate(b.start_date) ? b.start_date : today();
    const next = isDate(b.next_bill_date) ? b.next_bill_date : start;
    return { spot_id: spotId, boat_id: b.boat_id ? Number(b.boat_id) : null, billing_cycle: cycle, rate_cents: rate,
      start_date: start, next_bill_date: next, end_date: isDate(b.end_date) ? b.end_date : null, notes: b.notes || '' };
  };

  r.post('/customers/:id/contracts', requirePerm('contracts.edit'), (req, res) => {
    const cid = Number(req.params.id);
    const v = contractValues(req.body || {});
    const id = db.prepare(`INSERT INTO contracts (customer_id, spot_id, boat_id, billing_cycle, rate_cents, start_date, next_bill_date, end_date, notes)
      VALUES (@customer_id, @spot_id, @boat_id, @billing_cycle, @rate_cents, @start_date, @next_bill_date, @end_date, @notes)`).run({ ...v, customer_id: cid }).lastInsertRowid;
    const spot = v.spot_id ? db.prepare('SELECT label FROM spots WHERE id = ?').get(v.spot_id) : null;
    logActivity(db, 'rental', `Rental started${spot ? ' — spot ' + spot.label : ''}`, { customerId: cid, userId: req.user.id });
    // Anyone waiting who is this customer is now placed.
    db.prepare(`UPDATE waitlist SET status = 'placed', updated_at = datetime('now') WHERE customer_id = ? AND status IN ('waiting','offered')`).run(cid);
    // Renting a spot makes a prospect an active customer.
    db.prepare(`UPDATE customers SET status = 'active' WHERE id = ? AND status = 'prospect'`).run(cid);
    res.json({ id });
  });

  r.put('/contracts/:id', requirePerm('contracts.edit'), (req, res) => {
    const id = Number(req.params.id);
    const v = contractValues(req.body || {}, id);
    db.prepare(`UPDATE contracts SET spot_id = @spot_id, boat_id = @boat_id, billing_cycle = @billing_cycle, rate_cents = @rate_cents,
      start_date = @start_date, next_bill_date = @next_bill_date, end_date = @end_date, notes = @notes WHERE id = @id`).run({ ...v, id });
    res.json({ ok: true });
  });

  r.post('/contracts/:id/end', requirePerm('contracts.edit'), (req, res) => {
    const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
    if (!k) throw httpError(404, 'Rental not found.');
    const end = isDate(req.body?.end_date) ? req.body.end_date : today();
    db.prepare(`UPDATE contracts SET status = 'ended', end_date = ? WHERE id = ?`).run(end, k.id);
    logActivity(db, 'rental', `Rental ended ${end}`, { customerId: k.customer_id, userId: req.user.id });
    res.json({ ok: true });
  });

  // ---- Notes on customers, spots, incidents ----
  r.get('/notes', requirePerm('customers.view'), (req, res) => {
    const { entity_type, entity_id } = req.query;
    if (!NOTE_TYPES.includes(entity_type)) throw httpError(400, 'Bad note target.');
    res.json(db.prepare(`SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.entity_type = ? AND n.entity_id = ? ORDER BY n.created_at DESC, n.id DESC`).all(entity_type, Number(entity_id)));
  });
  r.post('/notes', requirePerm('customers.edit'), (req, res) => {
    const { entity_type, entity_id, body } = req.body || {};
    if (!NOTE_TYPES.includes(entity_type)) throw httpError(400, 'Bad note target.');
    if (!body || !String(body).trim()) throw httpError(400, 'Note is empty.');
    const id = db.prepare('INSERT INTO notes (entity_type, entity_id, body, author_id) VALUES (?, ?, ?, ?)')
      .run(entity_type, Number(entity_id), String(body).trim(), req.user.id).lastInsertRowid;
    res.json({ id });
  });
  r.delete('/notes/:id', requirePerm('customers.edit'), (req, res) => {
    const n = db.prepare('SELECT author_id FROM notes WHERE id = ?').get(req.params.id);
    if (!n) throw httpError(404, 'Note not found.');
    if (n.author_id !== req.user.id && !['admin', 'owner'].includes(req.user.role)) throw httpError(403, 'You can only delete your own notes.');
    db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return r;
};
