// Incident, equipment and facility log (with notes and photos via the shared endpoints).
const express = require('express');
const { requirePerm, httpError } = require('../lib/auth');
const { logActivity } = require('../lib/db');
const { today } = require('../lib/billing');
const { removeChildren } = require('../lib/cleanup');

const CATS = ['incident', 'equipment', 'facility'];

module.exports = ({ db, paths }) => {
  const r = express.Router();
  const P = requirePerm('incidents');

  r.get('/incidents', P, (req, res) => {
    const where = [], args = {};
    if (['open', 'resolved'].includes(req.query.status)) { where.push('i.status = @status'); args.status = req.query.status; }
    if (CATS.includes(req.query.category)) { where.push('i.category = @cat'); args.cat = req.query.category; }
    res.json(db.prepare(`SELECT i.*, TRIM(c.first_name || ' ' || c.last_name) AS customer_name, s.label AS spot_label, u.name AS created_by_name,
        (SELECT COUNT(*) FROM attachments a WHERE a.entity_type = 'incident' AND a.entity_id = i.id) AS photo_count
      FROM incidents i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN spots s ON s.id = i.spot_id LEFT JOIN users u ON u.id = i.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.status = 'resolved', i.occurred_on DESC, i.id DESC LIMIT 500`).all(args));
  });

  r.get('/incidents/:id', P, (req, res) => {
    const i = db.prepare(`SELECT i.*, TRIM(c.first_name || ' ' || c.last_name) AS customer_name, s.label AS spot_label, u.name AS created_by_name
      FROM incidents i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN spots s ON s.id = i.spot_id LEFT JOIN users u ON u.id = i.created_by
      WHERE i.id = ?`).get(req.params.id);
    if (!i) throw httpError(404, 'Not found.');
    res.json(i);
  });

  const vals = (b) => {
    if (!b.title || !String(b.title).trim()) throw httpError(400, 'Give it a short title.');
    return {
      title: String(b.title).trim(),
      description: b.description || '',
      occurred_on: /^\d{4}-\d{2}-\d{2}$/.test(b.occurred_on || '') ? b.occurred_on : today(),
      category: CATS.includes(b.category) ? b.category : 'incident',
      customer_id: b.customer_id ? Number(b.customer_id) : null,
      spot_id: b.spot_id ? Number(b.spot_id) : null,
      status: b.status === 'resolved' ? 'resolved' : 'open',
      resolution: b.resolution || '',
    };
  };

  r.post('/incidents', P, (req, res) => {
    const v = vals(req.body || {});
    const id = db.prepare(`INSERT INTO incidents (title, description, occurred_on, category, customer_id, spot_id, status, resolution, created_by)
      VALUES (@title, @description, @occurred_on, @category, @customer_id, @spot_id, @status, @resolution, @created_by)`).run({ ...v, created_by: req.user.id }).lastInsertRowid;
    logActivity(db, 'incident', `${v.category === 'incident' ? 'Incident' : v.category === 'equipment' ? 'Equipment note' : 'Facility note'} logged: ${v.title}`,
      { customerId: v.customer_id, userId: req.user.id });
    res.json({ id });
  });

  r.put('/incidents/:id', P, (req, res) => {
    const v = vals(req.body || {});
    const info = db.prepare(`UPDATE incidents SET title = @title, description = @description, occurred_on = @occurred_on, category = @category,
      customer_id = @customer_id, spot_id = @spot_id, status = @status, resolution = @resolution WHERE id = @id`).run({ ...v, id: Number(req.params.id) });
    if (!info.changes) throw httpError(404, 'Not found.');
    res.json({ ok: true });
  });

  r.delete('/incidents/:id', requirePerm('customers.delete'), (req, res) => {
    const id = Number(req.params.id);
    db.transaction(() => { db.prepare('DELETE FROM incidents WHERE id = ?').run(id); removeChildren(db, paths.uploadsDir, 'incident', id); })();
    res.json({ ok: true });
  });

  return r;
};
