// Optional Stripe card payments using Stripe Checkout (Stripe hosts the card form,
// so card numbers never touch this app). Off until an admin enters keys and turns it on.
const crypto = require('crypto');
const { logActivity, getSettings } = require('./db');
const { today } = require('./billing');
const { money } = require('./pdf');

const MOCK = () => process.env.STRIPE_MOCK === '1'; // test mode for development only

function isConfigured(s) {
  if (MOCK()) return s.stripeEnabled === 'true';
  return s.stripeEnabled === 'true' && /^sk_(live|test)_/.test(s.stripeSecretKey || '');
}

async function api(s, method, pathname, form) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${s.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Stripe: ${data.error?.message || res.status}`); e.status = 400; throw e; }
  return data;
}

async function createCheckout(s, { invoice, customer, successUrl, cancelUrl }) {
  if (!isConfigured(s)) { const e = new Error('Online payments are not turned on.'); e.status = 400; throw e; }
  if (MOCK()) {
    const id = 'cs_mock_' + crypto.randomBytes(6).toString('hex');
    return { id, url: successUrl.replace('{CHECKOUT_SESSION_ID}', id) };
  }
  return api(s, 'POST', '/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(invoice.total_cents),
    'line_items[0][price_data][product_data][name]': `${s.name} — Invoice ${invoice.number}`,
    ...(customer.email ? { customer_email: customer.email } : {}),
    client_reference_id: String(invoice.id),
    'metadata[invoice_id]': String(invoice.id),
    'metadata[invoice_number]': invoice.number,
    'payment_intent_data[description]': `Invoice ${invoice.number}`,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function getSession(s, id) {
  if (MOCK()) return { id, payment_status: 'paid', metadata: {} };
  return api(s, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

// Marks the invoice paid once Stripe confirms. Safe to call more than once.
function markPaid(db, invoiceId, sessionId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'paid' || inv.status === 'void') return false;
  db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_method = 'Card (online)', stripe_session_id = ? WHERE id = ?`)
    .run(today(), sessionId, inv.id);
  logActivity(db, 'payment', `Paid online: ${inv.number} ${money(inv.total_cents)}`, { customerId: inv.customer_id });
  return true;
}

// Called when a customer comes back from Stripe (works even without a webhook).
async function confirmReturn(db, invoice, sessionId) {
  const s = getSettings(db);
  if (!sessionId || !isConfigured(s)) return false;
  const sess = await getSession(s, sessionId);
  const invId = Number(sess.metadata?.invoice_id || invoice.id);
  if (sess.payment_status === 'paid' && invId === invoice.id) return markPaid(db, invoice.id, sessionId);
  return false;
}

// Stripe webhook signature check (Stripe-Signature: t=...,v1=...).
function verifyWebhook(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  const t = parts.t, sig = parts.v1;
  if (!t || !sig || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
}

// Gives an invoice a private pay-online token (created the first time it's needed).
function payToken(db, invoiceId) {
  const inv = db.prepare('SELECT pay_token FROM invoices WHERE id = ?').get(invoiceId);
  if (inv && inv.pay_token) return inv.pay_token;
  const t = crypto.randomBytes(20).toString('hex');
  db.prepare('UPDATE invoices SET pay_token = ? WHERE id = ?').run(t, invoiceId);
  return t;
}

function payLink(db, s, invoiceId, fallbackBase = '') {
  const base = (process.env.PUBLIC_URL || s.publicUrl || fallbackBase || '').replace(/\/+$/, '');
  return base ? `${base}/pay/${payToken(db, invoiceId)}` : '';
}

module.exports = { isConfigured, createCheckout, getSession, markPaid, confirmReturn, verifyWebhook, payToken, payLink };
