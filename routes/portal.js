// Customer portal (sign in by emailed link) and public pay-online pages.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { requirePerm, httpError, wrap } = require('../lib/auth');
const { getSettings, logActivity } = require('../lib/db');
const { invoicesPdf, money, usDate } = require('../lib/pdf');
const { sendMail, sendSms, emailReady, smsReady, baseUrl } = require('../lib/messaging');
const stripe = require('../lib/stripe');

const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '';
const CONTACT_FIELDS = ['phone', 'alt_phone', 'email', 'address', 'city', 'state', 'zip', 'emergency_name', 'emergency_phone'];

module.exports = ({ db, paths }) => {
  const staff = express.Router(); // mounted under /api (signed-in staff)
  const pub = express.Router(); // mounted under /api/public (no login)
  const portal = express.Router(); // mounted under /api/portal (signed-in customer)
  const pages = express.Router(); // page routes (/portal/login/:token)

  const base = (req) => baseUrl(getSettings(db)) || `${req.protocol}://${req.get('host')}`;

  // Simple per-IP limiter for public endpoints.
  const hits = new Map();
  const limit = (req, max = 30) => {
    const h = hits.get(req.ip) || { n: 0, at: Date.now() };
    if (Date.now() - h.at > 10 * 60 * 1000) { h.n = 0; h.at = Date.now(); }
    h.n++; hits.set(req.ip, h);
    if (h.n > max) throw httpError(429, 'Too many requests. Please try again in a few minutes.');
  };

  const makeToken = (customerId, minutes) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO portal_tokens (token, customer_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(token, customerId, `+${minutes} minutes`);
    return token;
  };

  // ---------- Staff: invite a customer to the portal ----------
  staff.post('/customers/:id/portal-invite', requirePerm('customers.edit'), wrap(async (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
    if (!c) throw httpError(404, 'Customer not found.');
    const s = getSettings(db);
    const url = `${base(req)}/portal/login/${makeToken(c.id, 7 * 24 * 60)}`;
    const via = req.body?.via;
    if (via === 'email') {
      if (!c.email) throw httpError(400, 'This customer has no email address.');
      if (!emailReady(s)) throw httpError(400, 'Email is not set up yet.');
      await sendMail(s, { to: c.email, subject: `Your ${s.name} account`,
        text: `Hi ${c.first_name || fullName(c)},\n\nYou can now see your storage details, invoices and signed agreements online${stripe.isConfigured(s) ? ', and pay by card' : ''}.\n\nOpen your account (link good for 7 days):\n${url}\n\nNext time, just go to ${base(req)}/portal and enter your email for a new sign-in link.\n\n${s.name}` });
    } else if (via === 'sms') {
      if (!c.phone) throw httpError(400, 'This customer has no phone number.');
      if (!smsReady(s)) throw httpError(400, 'Texting is not set up yet.');
      await sendSms(s, { to: c.phone, body: `${s.name}: view your storage account and invoices here: ${url}` });
    }
    if (via) logActivity(db, 'portal', `Account link sent by ${via === 'sms' ? 'text' : 'email'}`, { customerId: c.id, userId: req.user.id });
    res.json({ url });
  }));

  // ---------- Public: request a sign-in link ----------
  pub.post('/portal/request-link', wrap(async (req, res) => {
    limit(req, 10);
    const s = getSettings(db);
    if (s.portalEnabled !== 'true') throw httpError(403, 'Online accounts are not available.');
    const email = String(req.body?.email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter the email address we have on file.');
    const c = db.prepare(`SELECT * FROM customers WHERE email = ? COLLATE NOCASE AND status != 'inactive' ORDER BY status = 'active' DESC LIMIT 1`).get(email);
    // Same answer whether or not the email is on file, so addresses can't be probed.
    if (c && emailReady(s)) {
      const url = `${base(req)}/portal/login/${makeToken(c.id, 30)}`;
      await sendMail(s, { to: c.email, subject: `Sign in to your ${s.name} account`,
        text: `Hi ${c.first_name || fullName(c)},\n\nUse this link to sign in (good for 30 minutes):\n${url}\n\nIf you didn't ask for this, you can ignore this email.\n\n${s.name}` }).catch((e) => console.error('portal link email:', e.message));
    }
    res.json({ ok: true });
  }));

  // ---------- Page: sign in from a link ----------
  pages.get('/portal/login/:token', (req, res) => {
    const t = db.prepare(`SELECT * FROM portal_tokens WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')`).get(String(req.params.token));
    if (!t) return res.redirect('/portal?expired=1');
    db.prepare(`UPDATE portal_tokens SET used_at = datetime('now') WHERE token = ?`).run(t.token);
    db.prepare(`UPDATE customers SET portal_last_login = datetime('now') WHERE id = ?`).run(t.customer_id);
    req.session.pc = t.customer_id;
    res.redirect('/portal');
  });
  pages.get('/portal', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'portal.html')));
  pages.get(/^\/pay\/[a-f0-9]{40}$/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pay.html')));

  // ---------- Customer portal API ----------
  portal.use((req, res, next) => {
    const s = getSettings(db);
    const id = req.session && req.session.pc;
    const c = id ? db.prepare(`SELECT * FROM customers WHERE id = ? AND status != 'inactive'`).get(id) : null;
    if (!c || s.portalEnabled !== 'true') return res.status(401).json({ error: 'Please sign in.', company: { name: s.name, brandColor: s.brandColor, phone: s.phone } });
    req.customer = c;
    next();
  });

  portal.get('/me', (req, res) => {
    const c = req.customer;
    const s = getSettings(db);
    const payOn = stripe.isConfigured(s);
    res.json({
      company: { name: s.name, brandColor: s.brandColor, phone: s.phone, email: s.email, address: [s.address, [s.city, s.state].filter(Boolean).join(', '), s.zip].filter(Boolean).join(' ') },
      customer: Object.fromEntries(['id', 'first_name', 'last_name', 'company', 'sms_ok', ...CONTACT_FIELDS].map((k) => [k, c[k]])),
      rentals: db.prepare(`SELECT k.billing_cycle, k.rate_cents, k.start_date, k.end_date, k.next_bill_date, s.label AS spot, b.name AS building, l.name AS location,
          bo.name AS boat_name, bo.make AS boat_make, bo.model AS boat_model
        FROM contracts k LEFT JOIN spots s ON s.id = k.spot_id LEFT JOIN buildings b ON b.id = s.building_id LEFT JOIN locations l ON l.id = b.location_id
        LEFT JOIN boats bo ON bo.id = k.boat_id WHERE k.customer_id = ? AND k.status = 'active'`).all(c.id),
      boats: db.prepare('SELECT name, make, model, year, length_ft, registration, insurance_carrier, insurance_expires FROM boats WHERE customer_id = ?').all(c.id),
      invoices: db.prepare(`SELECT id, number, issue_date, due_date, total_cents, status, paid_at, paid_method FROM invoices
        WHERE customer_id = ? AND status IN ('sent','paid') ORDER BY status = 'sent' DESC, issue_date DESC, id DESC LIMIT 60`).all(c.id),
      agreements: db.prepare(`SELECT id, title, status, sent_at, signed_at, attachment_id, CASE WHEN status = 'sent' THEN token END AS token
        FROM agreements WHERE customer_id = ? AND status IN ('sent','signed') ORDER BY id DESC`).all(c.id),
      payOnline: payOn,
    });
  });

  portal.get('/invoices/:id/pdf', wrap(async (req, res) => {
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND customer_id = ? AND status IN ('sent','paid')`).get(Number(req.params.id), req.customer.id);
    if (!inv) throw httpError(404, 'Invoice not found.');
    const pdf = await invoicesPdf([{ invoice: inv, items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id), customer: req.customer }], getSettings(db));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="Invoice-${inv.number}.pdf"`);
    res.send(pdf);
  }));

  // Signed agreement PDFs only.
  portal.get('/agreements/:id/pdf', (req, res) => {
    const a = db.prepare(`SELECT a.attachment_id, f.filename FROM agreements a JOIN attachments f ON f.id = a.attachment_id
      WHERE a.id = ? AND a.customer_id = ? AND a.status = 'signed'`).get(Number(req.params.id), req.customer.id);
    if (!a) throw httpError(404, 'Not found.');
    res.set('Content-Type', 'application/pdf');
    res.sendFile(path.join(paths.uploadsDir, path.basename(a.filename)));
  });

  portal.put('/me', (req, res) => {
    const c = req.customer;
    const b = req.body || {};
    const changes = [];
    const next = {};
    for (const k of CONTACT_FIELDS) {
      const v = b[k] == null ? c[k] : String(b[k]).trim().slice(0, 200);
      if ((v || '') !== (c[k] || '')) changes.push(k.replace(/_/g, ' '));
      next[k] = v;
    }
    if (next.email && !/^\S+@\S+\.\S+$/.test(next.email)) throw httpError(400, 'That email address doesn’t look right.');
    const sms = b.sms_ok === true ? 1 : b.sms_ok === false ? 0 : c.sms_ok;
    if (sms !== c.sms_ok) changes.push(sms ? 'agreed to texts' : 'stopped texts');
    db.prepare(`UPDATE customers SET ${CONTACT_FIELDS.map((k) => `${k} = @${k}`).join(', ')}, sms_ok = @sms WHERE id = @id`).run({ ...next, sms, id: c.id });
    if (changes.length) logActivity(db, 'portal', `Customer updated their info online: ${changes.join(', ')}`, { customerId: c.id });
    res.json({ ok: true });
  });

  portal.post('/invoices/:id/checkout', wrap(async (req, res) => {
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND customer_id = ? AND status = 'sent'`).get(Number(req.params.id), req.customer.id);
    if (!inv) throw httpError(400, 'This invoice can’t be paid online.');
    const b = base(req);
    const sess = await stripe.createCheckout(getSettings(db), { invoice: inv, customer: req.customer,
      successUrl: `${b}/portal?paid=${inv.id}&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${b}/portal` });
    res.json({ url: sess.url });
  }));

  portal.post('/confirm', wrap(async (req, res) => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND customer_id = ?').get(Number(req.body?.invoice_id), req.customer.id);
    if (!inv) throw httpError(404, 'Invoice not found.');
    await stripe.confirmReturn(db, inv, String(req.body?.session_id || ''));
    res.json({ status: db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status });
  }));

  portal.post('/logout', (req, res) => { if (req.session) req.session.pc = null; res.json({ ok: true }); });

  // ---------- Public pay-online link (from emailed invoices) ----------
  const byPayToken = (t) => (/^[a-f0-9]{40}$/.test(t || '') ? db.prepare('SELECT * FROM invoices WHERE pay_token = ?').get(t) : null);

  pub.get('/pay/:token', (req, res) => {
    limit(req, 60);
    const inv = byPayToken(req.params.token);
    if (!inv || inv.status === 'void' || inv.status === 'draft') throw httpError(404, 'This payment link is not valid.');
    const s = getSettings(db);
    const c = db.prepare('SELECT first_name, last_name, company FROM customers WHERE id = ?').get(inv.customer_id);
    res.json({
      company: { name: s.name, brandColor: s.brandColor, phone: s.phone },
      invoice: { number: inv.number, total_cents: inv.total_cents, due_date: inv.due_date, status: inv.status, paid_at: inv.paid_at, issue_date: inv.issue_date },
      items: db.prepare('SELECT description, amount_cents FROM invoice_items WHERE invoice_id = ?').all(inv.id),
      customer_name: fullName(c),
      payOnline: stripe.isConfigured(s),
    });
  });

  pub.post('/pay/:token/checkout', wrap(async (req, res) => {
    limit(req, 20);
    const inv = byPayToken(req.params.token);
    if (!inv || inv.status !== 'sent') throw httpError(400, 'This invoice can’t be paid online.');
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
    const b = base(req);
    const sess = await stripe.createCheckout(getSettings(db), { invoice: inv, customer: c,
      successUrl: `${b}/pay/${inv.pay_token}?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${b}/pay/${inv.pay_token}` });
    res.json({ url: sess.url });
  }));

  pub.post('/pay/:token/confirm', wrap(async (req, res) => {
    limit(req, 30);
    const inv = byPayToken(req.params.token);
    if (!inv) throw httpError(404, 'Not found.');
    await stripe.confirmReturn(db, inv, String(req.body?.session_id || ''));
    res.json({ status: db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status });
  }));

  // ---------- Stripe webhook (raw body; mounted before the JSON parser) ----------
  const webhook = [express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    const s = getSettings(db);
    const raw = req.body instanceof Buffer ? req.body.toString('utf8') : '';
    if (!stripe.verifyWebhook(raw, req.get('stripe-signature'), s.stripeWebhookSecret)) return res.status(400).send('Bad signature');
    let evt; try { evt = JSON.parse(raw); } catch { return res.status(400).send('Bad JSON'); }
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      const sess = evt.data.object;
      const id = Number(sess.metadata?.invoice_id || sess.client_reference_id);
      if (id && sess.payment_status === 'paid') stripe.markPaid(db, id, sess.id);
    }
    res.json({ received: true });
  }];

  return { staff, pub, portal, pages, webhook };
};
