// Letters: templates, one-off letters from a customer, and bulk letters to a group.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requirePerm, httpError, wrap } = require('../lib/auth');
const { getSettings, logActivity } = require('../lib/db');
const { letterFields, render, AUDIENCES, lettersPdf } = require('../lib/letters');
const { sendMail, emailReady } = require('../lib/messaging');
const { locationId, SQL } = require('../lib/locations');

module.exports = ({ db, paths }) => {
  const r = express.Router();
  const P = requirePerm('letters');

  const portalLink = (s) => ((process.env.PUBLIC_URL || s.publicUrl || '').replace(/\/+$/, '') + '/portal');

  // ---- Templates ----
  r.get('/letter-templates', P, (req, res) => {
    res.json(db.prepare('SELECT * FROM letter_templates ORDER BY sort, id').all());
  });
  const tplVals = (b) => {
    if (!b.name || !b.subject || !b.body) throw httpError(400, 'Name, subject and letter text are required.');
    return [String(b.name).trim(), ['thanks', 'warning', 'notice', 'general'].includes(b.category) ? b.category : 'general', String(b.subject), String(b.body)];
  };
  r.post('/letter-templates', P, (req, res) => {
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM letter_templates').get().n;
    res.json({ id: db.prepare('INSERT INTO letter_templates (name, category, subject, body, sort) VALUES (?, ?, ?, ?, ?)').run(...tplVals(req.body || {}), sort).lastInsertRowid });
  });
  r.put('/letter-templates/:id', P, (req, res) => {
    db.prepare('UPDATE letter_templates SET name = ?, category = ?, subject = ?, body = ? WHERE id = ?').run(...tplVals(req.body || {}), req.params.id);
    res.json({ ok: true });
  });
  r.delete('/letter-templates/:id', P, (req, res) => {
    db.prepare('DELETE FROM letter_templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  const merged = (tpl, customerId, s) => {
    const f = letterFields(db, customerId, s, { portal_link: portalLink(s) });
    return { subject: render(tpl.subject, f), body: render(tpl.body, f) };
  };

  r.get('/letters/preview', P, (req, res) => {
    const tpl = db.prepare('SELECT * FROM letter_templates WHERE id = ?').get(Number(req.query.template_id));
    if (!tpl) throw httpError(404, 'Template not found.');
    const s = getSettings(db);
    let cid = Number(req.query.customer_id);
    if (!cid) cid = (db.prepare(`SELECT id FROM customers WHERE status = 'active' ORDER BY id LIMIT 1`).get() || {}).id;
    if (!cid) return res.json({ subject: tpl.subject, body: tpl.body });
    res.json(merged(tpl, cid, s));
  });

  // Saves a letter: PDF into the customer's documents, a history row, and an activity entry.
  async function saveLetter({ customer, subject, body, templateId, via, userId, s }) {
    const pdf = await lettersPdf([{ customer, subject, body }], s);
    const file = crypto.randomBytes(16).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(paths.uploadsDir, file), pdf);
    const safe = subject.replace(/[^\w ,.-]/g, '').trim().slice(0, 60) || 'Letter';
    const attId = db.prepare(`INSERT INTO attachments (entity_type, entity_id, filename, original_name, mime, caption, uploaded_by) VALUES ('customer', ?, ?, ?, 'application/pdf', ?, ?)`)
      .run(customer.id, file, `Letter - ${safe}.pdf`, `Letter: ${subject}`, userId).lastInsertRowid;
    const id = db.prepare('INSERT INTO letters (template_id, customer_id, subject, body, via, attachment_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(templateId || null, customer.id, subject, body, via, attId, userId).lastInsertRowid;
    logActivity(db, 'letter', `Letter ${via === 'email' ? 'emailed' : 'printed'}: ${subject}`, { customerId: customer.id, userId });
    return { id: Number(id), pdf, attachment_id: Number(attId) };
  }

  async function emailLetter(s, customer, subject, body, pdf) {
    await sendMail(s, { to: customer.email, subject, text: `${body}\n\nSincerely,\n${s.name}${s.phone ? '\n' + s.phone : ''}`,
      attachments: [{ filename: `${subject.replace(/[^\w ,.-]/g, '').slice(0, 60) || 'Letter'}.pdf`, content: pdf }] });
  }

  // One letter to one customer (text may be edited before sending).
  r.post('/letters/send', P, wrap(async (req, res) => {
    const { customer_id, subject, body, template_id, via } = req.body || {};
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customer_id));
    if (!customer) throw httpError(404, 'Customer not found.');
    if (!subject || !body) throw httpError(400, 'The letter needs a subject and text.');
    const s = getSettings(db);
    if (via === 'email') {
      if (!customer.email) throw httpError(400, 'This customer has no email address.');
      if (!emailReady(s)) throw httpError(400, 'Email is not set up yet (Setup → Email & texts).');
    }
    const saved = await saveLetter({ customer, subject, body, templateId: template_id, via: via === 'email' ? 'email' : 'print', userId: req.user.id, s });
    if (via === 'email') await emailLetter(s, customer, subject, body, saved.pdf);
    res.json({ id: saved.id, pdf_url: `/api/attachments/${saved.attachment_id}/file` });
  }));

  // Who a bulk letter would go to.
  const audienceIds = (req, audience, ids) => {
    if (audience === 'selected') return (ids || []).map(Number).filter(Boolean);
    const a = AUDIENCES[audience];
    if (!a) throw httpError(400, 'Pick who the letter goes to.');
    const loc = locationId(req);
    return db.prepare(`${a.sql}${loc ? `${/ WHERE /i.test(a.sql) ? ' AND' : ' WHERE'} ${SQL.customerIn('c.id', loc)}` : ''}`).all().map((x) => x.id);
  };

  r.get('/letters/audiences', P, (req, res) => {
    res.json(Object.entries(AUDIENCES).map(([key, a]) => ({ key, label: a.label, count: audienceIds(req, key).length })));
  });

  r.post('/letters/bulk', P, wrap(async (req, res) => {
    const { template_id, audience, customer_ids, via } = req.body || {};
    const tpl = db.prepare('SELECT * FROM letter_templates WHERE id = ?').get(Number(template_id));
    if (!tpl) throw httpError(400, 'Pick a letter.');
    const ids = audienceIds(req, audience, customer_ids);
    if (!ids.length) throw httpError(400, 'Nobody matches that group.');
    if (ids.length > 1000) throw httpError(400, 'That is more than 1,000 letters. Narrow the group.');
    const s = getSettings(db);
    const canEmail = via !== 'print' && emailReady(s);
    const out = { emailed: 0, printed: 0, failed: [] };
    const toPrint = [];
    for (const id of ids) {
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      if (!customer) continue;
      const { subject, body } = merged(tpl, id, s);
      const byEmail = canEmail && customer.email;
      try {
        const saved = await saveLetter({ customer, subject, body, templateId: tpl.id, via: byEmail ? 'email' : 'print', userId: req.user.id, s });
        if (byEmail) { await emailLetter(s, customer, subject, body, saved.pdf); out.emailed++; } else { toPrint.push(saved.id); out.printed++; }
      } catch (e) { out.failed.push({ customer: [customer.first_name, customer.last_name].join(' '), error: e.message }); }
    }
    out.print_url = toPrint.length ? `/api/letters/pdf?ids=${toPrint.join(',')}` : null;
    res.json(out);
  }));

  // Several saved letters in one PDF for printing.
  r.get('/letters/pdf', P, wrap(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 1000);
    const rows = ids.map((id) => db.prepare('SELECT * FROM letters WHERE id = ?').get(id)).filter(Boolean);
    if (!rows.length) throw httpError(404, 'No letters found.');
    const s = getSettings(db);
    const pdf = await lettersPdf(rows.map((l) => ({ customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(l.customer_id), subject: l.subject, body: l.body, date: l.created_at.slice(0, 10) })), s);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="Letters-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdf);
  }));

  r.get('/letters', P, (req, res) => {
    const cid = Number(req.query.customer_id);
    res.json(db.prepare(`SELECT l.id, l.subject, l.via, l.attachment_id, l.created_at, u.name AS created_by_name, TRIM(c.first_name || ' ' || c.last_name) AS customer_name
      FROM letters l LEFT JOIN users u ON u.id = l.created_by JOIN customers c ON c.id = l.customer_id
      ${cid ? 'WHERE l.customer_id = ' + cid : ''} ORDER BY l.id DESC LIMIT 200`).all());
  });

  return r;
};
