// Waitlist: people waiting for a spot, and matching them to vacant spots.
const express = require('express');
const { requirePerm, httpError } = require('../lib/auth');
const { logActivity } = require('../lib/db');
const { locationId } = require('../lib/locations');

const STATUSES = ['waiting', 'offered', 'placed', 'removed'];

module.exports = ({ db }) => {
  const r = express.Router();
  const VIEW = requirePerm('customers.view');
  const EDIT = requirePerm('customers.edit');

  const SELECT = `SELECT w.*, t.name AS spot_type_name, l.name AS location_name,
      TRIM(c.first_name || ' ' || c.last_name) AS customer_name
    FROM waitlist w LEFT JOIN spot_types t ON t.id = w.spot_type_id LEFT JOIN locations l ON l.id = w.location_id
    LEFT JOIN customers c ON c.id = w.customer_id`;

  r.get('/waitlist', VIEW, (req, res) => {
    const where = [];
    const st = String(req.query.status || 'active');
    if (st === 'active') where.push(`w.status IN ('waiting','offered')`);
    else if (STATUSES.includes(st)) where.push(`w.status = '${st}'`);
    const loc = locationId(req);
    if (loc) where.push(`(w.location_id IS NULL OR w.location_id = ${loc})`);
    res.json(db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.created_at, w.id`).all());
  });

  // Waiting people who fit a vacant spot: same type (or no preference), same location (or any), boat fits.
  r.get('/waitlist/matches', VIEW, (req, res) => {
    const spot = db.prepare(`SELECT s.*, b.location_id FROM spots s JOIN buildings b ON b.id = s.building_id WHERE s.id = ?`).get(Number(req.query.spot_id));
    if (!spot) throw httpError(404, 'Spot not found.');
    res.json(db.prepare(`${SELECT} WHERE w.status IN ('waiting','offered')
        AND (w.spot_type_id IS NULL OR w.spot_type_id = @type)
        AND (w.location_id IS NULL OR w.location_id = @loc)
        AND (w.boat_length_ft IS NULL OR @len IS NULL OR w.boat_length_ft <= @len)
      ORDER BY w.created_at, w.id LIMIT 20`).all({ type: spot.spot_type_id, loc: spot.location_id, len: spot.length_ft }));
  });

  const vals = (b) => {
    const name = String(b.name || '').trim();
    if (!name && !b.customer_id) throw httpError(400, 'Enter a name.');
    const len = parseFloat(b.boat_length_ft);
    return {
      name,
      phone: b.phone || '',
      email: b.email || '',
      customer_id: b.customer_id ? Number(b.customer_id) : null,
      boat_length_ft: Number.isFinite(len) ? len : null,
      spot_type_id: b.spot_type_id ? Number(b.spot_type_id) : null,
      location_id: b.location_id ? Number(b.location_id) : null,
      wanted_by: /^\d{4}-\d{2}-\d{2}$/.test(b.wanted_by || '') ? b.wanted_by : null,
      notes: b.notes || '',
      status: STATUSES.includes(b.status) ? b.status : 'waiting',
    };
  };

  r.post('/waitlist', EDIT, (req, res) => {
    const v = vals(req.body || {});
    if (!v.name && v.customer_id) {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(v.customer_id);
      v.name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company;
      v.phone = v.phone || c.phone || ''; v.email = v.email || c.email || '';
    }
    const id = db.prepare(`INSERT INTO waitlist (name, phone, email, customer_id, boat_length_ft, spot_type_id, location_id, wanted_by, notes, status)
      VALUES (@name, @phone, @email, @customer_id, @boat_length_ft, @spot_type_id, @location_id, @wanted_by, @notes, @status)`).run(v).lastInsertRowid;
    logActivity(db, 'waitlist', `Added to waitlist: ${v.name}`, { customerId: v.customer_id, userId: req.user.id });
    res.json({ id });
  });

  r.put('/waitlist/:id', EDIT, (req, res) => {
    const v = vals(req.body || {});
    const info = db.prepare(`UPDATE waitlist SET name = @name, phone = @phone, email = @email, customer_id = @customer_id, boat_length_ft = @boat_length_ft,
      spot_type_id = @spot_type_id, location_id = @location_id, wanted_by = @wanted_by, notes = @notes, status = @status, updated_at = datetime('now')
      WHERE id = @id`).run({ ...v, id: Number(req.params.id) });
    if (!info.changes) throw httpError(404, 'Not found.');
    res.json({ ok: true });
  });

  r.post('/waitlist/:id/status', EDIT, (req, res) => {
    const st = req.body?.status;
    if (!STATUSES.includes(st)) throw httpError(400, 'Bad status.');
    db.prepare(`UPDATE waitlist SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(st, req.params.id);
    res.json({ ok: true });
  });

  // Turn a waitlist entry into a customer record (keeps the entry linked).
  r.post('/waitlist/:id/customer', EDIT, (req, res) => {
    const w = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(req.params.id);
    if (!w) throw httpError(404, 'Not found.');
    if (w.customer_id) return res.json({ customer_id: w.customer_id });
    const parts = w.name.trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop() : '';
    const cid = db.prepare(`INSERT INTO customers (first_name, last_name, phone, email, status) VALUES (?, ?, ?, ?, 'prospect')`)
      .run(parts.join(' '), last, w.phone || '', w.email || '').lastInsertRowid;
    if (w.boat_length_ft) db.prepare('INSERT INTO boats (customer_id, length_ft) VALUES (?, ?)').run(cid, w.boat_length_ft);
    if (w.notes) db.prepare(`INSERT INTO notes (entity_type, entity_id, body, author_id) VALUES ('customer', ?, ?, ?)`).run(cid, `From waitlist: ${w.notes}`, req.user.id);
    db.prepare(`UPDATE waitlist SET customer_id = ?, status = 'offered', updated_at = datetime('now') WHERE id = ?`).run(cid, w.id);
    logActivity(db, 'customer', `New customer from waitlist: ${w.name}`, { customerId: cid, userId: req.user.id });
    res.json({ customer_id: Number(cid) });
  });

  r.delete('/waitlist/:id', EDIT, (req, res) => {
    db.prepare('DELETE FROM waitlist WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return r;
};
