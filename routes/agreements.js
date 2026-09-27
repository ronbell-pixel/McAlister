// E-signature rental agreements: send, sign (public link), signed PDF.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requirePerm, httpError, wrap } = require('../lib/auth');
const { getSettings, logActivity } = require('../lib/db');
const { mergeFields, render, sha256, signedPdf } = require('../lib/agreement');
const { baseUrl, sendMail, sendSms, emailReady, smsReady } = require('../lib/messaging');

const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '';

module.exports = ({ db, paths }) => {
  const r = express.Router();
  const P = requirePerm('contracts.edit');

  const linkFor = (req, ag) => {
    const base = baseUrl(getSettings(db)) || `${req.protocol}://${req.get('host')}`;
    return `${base}/sign/${ag.token}`;
  };

  async function deliver(req, ag, via) {
    const s = getSettings(db);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(ag.customer_id);
    const url = linkFor(req, ag);
    const first = c.first_name || fullName(c);
    if (via === 'email') {
      if (!c.email) throw httpError(400, `${fullName(c)} has no email address.`);
      if (!emailReady(s)) throw httpError(400, 'Email is not set up yet (Setup → Email & texts).');
      await sendMail(s, {
        to: c.email,
        subject: `Please sign: ${ag.title} — ${s.name}`,
        text: `Hi ${first},\n\nPlease review and sign your ${ag.title.toLowerCase()} with ${s.name}. It takes about a minute and works on your phone:\n\n${url}\n\nThe link is good for 30 days.${s.phone ? ` Questions? Call ${s.phone}.` : ''}\n\nThank you,\n${s.name}`,
      });
    } else if (via === 'sms') {
      if (!c.phone) throw httpError(400, `${fullName(c)} has no phone number.`);
      if (!smsReady(s)) throw httpError(400, 'Texting is not set up yet (Setup → Email & texts).');
      await sendSms(s, { to: c.phone, body: `${s.name}: please review and sign your storage agreement: ${url}` });
    }
    if (via === 'email' || via === 'sms') {
      db.prepare(`UPDATE agreements SET sent_via = ?, sent_at = datetime('now') WHERE id = ?`).run(via, ag.id);
      logActivity(db, 'agreement', `Agreement sent by ${via === 'sms' ? 'text' : 'email'}`, { customerId: ag.customer_id, userId: req.user.id });
    }
  }

  r.get('/agreements', requirePerm('customers.view'), (req, res) => {
    const cid = Number(req.query.customer_id);
    res.json(db.prepare(`SELECT id, contract_id, title, status, sent_at, sent_via, viewed_at, signed_at, signer_name, attachment_id, expires_at
      FROM agreements WHERE customer_id = ? ORDER BY id DESC`).all(cid));
  });

  // Preview the agreement text for a rental (or the template with sample data).
  r.get('/agreements/preview', P, (req, res) => {
    const s = getSettings(db);
    let fields;
    if (req.query.contract_id) {
      const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(req.query.contract_id));
      if (!k) throw httpError(404, 'Rental not found.');
      fields = mergeFields(db, k.id, k.customer_id, s);
    } else {
      const k = db.prepare(`SELECT * FROM contracts WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
      fields = k ? mergeFields(db, k.id, k.customer_id, s) : null;
    }
    const template = req.query.template != null ? String(req.query.template) : s.agreementTemplate;
    res.json({ title: s.agreementTitle, body: fields ? render(template, fields) : template, sample: !req.query.contract_id });
  });

  // Create an agreement for a rental and optionally send it.
  r.post('/contracts/:id/agreement', P, wrap(async (req, res) => {
    const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(req.params.id));
    if (!k) throw httpError(404, 'Rental not found.');
    const s = getSettings(db);
    const body = render(s.agreementTemplate, mergeFields(db, k.id, k.customer_id, s));
    const token = crypto.randomBytes(24).toString('hex');
    let id;
    db.transaction(() => {
      // Only one open agreement per rental.
      db.prepare(`UPDATE agreements SET status = 'void' WHERE contract_id = ? AND status = 'sent'`).run(k.id);
      id = db.prepare(`INSERT INTO agreements (contract_id, customer_id, token, title, body, body_sha256, expires_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'), ?)`)
        .run(k.id, k.customer_id, token, s.agreementTitle || 'Storage Agreement', body, sha256(body), req.user.id).lastInsertRowid;
    })();
    const ag = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
    const via = req.body?.via;
    if (via === 'email' || via === 'sms') await deliver(req, ag, via);
    else logActivity(db, 'agreement', 'Agreement prepared for signing', { customerId: k.customer_id, userId: req.user.id });
    res.json({ id: Number(id), url: linkFor(req, ag) });
  }));

  r.post('/agreements/:id/send', P, wrap(async (req, res) => {
    const ag = db.prepare('SELECT * FROM agreements WHERE id = ?').get(Number(req.params.id));
    if (!ag || ag.status !== 'sent') throw httpError(400, 'This agreement is not waiting for a signature.');
    db.prepare(`UPDATE agreements SET expires_at = datetime('now', '+30 days') WHERE id = ?`).run(ag.id);
    await deliver(req, ag, req.body?.via);
    res.json({ ok: true, url: linkFor(req, ag) });
  }));

  r.get('/agreements/:id/link', P, (req, res) => {
    const ag = db.prepare('SELECT * FROM agreements WHERE id = ?').get(Number(req.params.id));
    if (!ag) throw httpError(404, 'Not found.');
    res.json({ url: linkFor(req, ag) });
  });

  r.post('/agreements/:id/void', P, (req, res) => {
    db.prepare(`UPDATE agreements SET status = 'void' WHERE id = ? AND status = 'sent'`).run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Public signing (no login; the long random link is the key) ----------
  const pub = express.Router();
  const tries = new Map();
  const limited = (ip) => {
    const t = tries.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - t.at > 10 * 60 * 1000) { t.n = 0; t.at = Date.now(); }
    t.n++; tries.set(ip, t);
    return t.n > 60;
  };
  const byToken = (token) => {
    if (!/^[a-f0-9]{48}$/.test(token || '')) return null;
    return db.prepare('SELECT * FROM agreements WHERE token = ?').get(token);
  };

  pub.get('/agreements/:token', (req, res) => {
    if (limited(req.ip)) throw httpError(429, 'Too many requests. Please try again later.');
    const ag = byToken(req.params.token);
    const s = getSettings(db);
    if (!ag || ag.status === 'void') throw httpError(404, 'This signing link is no longer valid. Please contact us for a new one.');
    if (ag.status === 'sent' && ag.expires_at && ag.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) {
      throw httpError(410, 'This signing link has expired. Please contact us for a new one.');
    }
    if (!ag.viewed_at) db.prepare(`UPDATE agreements SET viewed_at = datetime('now') WHERE id = ?`).run(ag.id);
    const c = db.prepare('SELECT first_name, last_name, company FROM customers WHERE id = ?').get(ag.customer_id);
    res.json({
      company: { name: s.name, brandColor: s.brandColor, phone: s.phone },
      title: ag.title, body: ag.body, status: ag.status, signed_at: ag.signed_at, signer_name: ag.signer_name,
      suggestedName: fullName(c),
    });
  });

  pub.post('/agreements/:token/sign', express.json({ limit: '1mb' }), wrap(async (req, res) => {
    if (limited(req.ip)) throw httpError(429, 'Too many requests. Please try again later.');
    const ag = byToken(req.params.token);
    if (!ag || ag.status === 'void') throw httpError(404, 'This signing link is no longer valid.');
    if (ag.status === 'signed') throw httpError(400, 'This agreement is already signed.');
    if (ag.expires_at && ag.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) throw httpError(410, 'This signing link has expired.');
    const { name, signature, agree } = req.body || {};
    if (!agree) throw httpError(400, 'Please check the box to agree.');
    if (!name || String(name).trim().length < 2) throw httpError(400, 'Please type your full name.');
    if (typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,') || signature.length > 600000) {
      throw httpError(400, 'Please sign in the box.');
    }
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    db.prepare(`UPDATE agreements SET status = 'signed', signed_at = datetime('now'), signer_name = ?, signature_png = ?, signer_ip = ?, signer_ua = ?
      WHERE id = ? AND status = 'sent'`).run(String(name).trim().slice(0, 120), signature, ip, String(req.get('user-agent') || '').slice(0, 300), ag.id);

    // Signed PDF saved to the customer's documents.
    const s = getSettings(db);
    const signed = db.prepare('SELECT * FROM agreements WHERE id = ?').get(ag.id);
    const pdf = await signedPdf(signed, s);
    const file = crypto.randomBytes(16).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(paths.uploadsDir, file), pdf);
    const safeTitle = signed.title.replace(/[^\w -]/g, '').trim() || 'Agreement';
    const attId = db.prepare(`INSERT INTO attachments (entity_type, entity_id, filename, original_name, mime, caption) VALUES ('customer', ?, ?, ?, 'application/pdf', ?)`)
      .run(signed.customer_id, file, `${safeTitle} - signed ${signed.signed_at.slice(0, 10)}.pdf`, `Signed ${signed.title}`).lastInsertRowid;
    db.prepare('UPDATE agreements SET attachment_id = ? WHERE id = ?').run(attId, ag.id);
    logActivity(db, 'agreement', `Agreement signed by ${signed.signer_name}`, { customerId: signed.customer_id });

    // Copies by email (best effort — signing already succeeded).
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(signed.customer_id);
    const att = [{ filename: `${safeTitle} (signed).pdf`, content: pdf }];
    try {
      if (c.email && emailReady(s)) await sendMail(s, { to: c.email, subject: `Your signed ${signed.title}`, text: `Hi ${c.first_name || fullName(c)},\n\nThank you for signing. Your copy is attached.\n\n${s.name}`, attachments: att });
      if (s.email && emailReady(s)) await sendMail(s, { to: s.email, subject: `Signed: ${fullName(c)} — ${signed.title}`, text: `${fullName(c)} signed their agreement. A copy is attached and saved on their customer record.`, attachments: att });
    } catch (e) { console.error('agreement copy email failed:', e.message); }

    res.json({ ok: true, signed_at: signed.signed_at });
  }));

  return { r, pub };
};
