// Reminders: preview what's due, send now, and history.
const express = require('express');
const { requirePerm, wrap } = require('../lib/auth');
const reminders = require('../lib/reminders');
const { getSettings } = require('../lib/db');

module.exports = ({ db }) => {
  const r = express.Router();
  const P = requirePerm('invoices');

  r.get('/reminders/preview', P, (req, res) => {
    const s = getSettings(db);
    res.json({ enabled: s.remindersEnabled === 'true', lastRun: s.lastReminderRun || null, items: reminders.collect(db, s) });
  });

  r.post('/reminders/run', P, wrap(async (req, res) => {
    res.json(await reminders.run(db, { userId: req.user.id }));
  }));

  r.get('/reminders/log', P, (req, res) => {
    res.json(db.prepare(`SELECT l.*, TRIM(c.first_name || ' ' || c.last_name) AS customer_name FROM reminder_log l
      LEFT JOIN customers c ON c.id = l.customer_id ORDER BY l.id DESC LIMIT 200`).all().map((x) => ({ ...x, label: reminders.KIND_LABEL[x.kind] || x.kind })));
  });

  return r;
};
