// Invoices: automatic billing runs, manual invoices, PDF/print, email, payments.
const express = require('express');
const { requirePerm, httpError, wrap } = require('../lib/auth');
const { getSettings, logActivity } = require('../lib/db');
const { runBilling, recalcTotal, nextInvoiceNumber, today, addDays } = require('../lib/billing');
const { invoicesPdf, money, usDate } = require('../lib/pdf');
const { sendMail } = require('../lib/mailer');

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

module.exports = ({ db }) => {
  const r = express.Router();
  const P = requirePerm('invoices');

  const loadFull = (id) => {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) throw httpError(404, 'Invoice not found.');
    return {
      invoice,
      items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(id),
      customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id),
    };
  };
  const nameOf = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || 'Customer';

  r.get('/invoices', P, (req, res) => {
    const where = [];
    const args = { today: today() };
    const st = String(req.query.status || '');
    if (st === 'overdue') where.push(`i.status = 'sent' AND i.due_date < @today`);
    else if (st === 'open') where.push(`i.status = 'sent'`);
    else if (['draft', 'sent', 'paid', 'void'].includes(st)) { where.push('i.status = @st'); args.st = st; }
    if (req.query.customer_id) { where.push('i.customer_id = @cid'); args.cid = Number(req.query.customer_id); }
    if (req.query.q) {
      where.push(`(i.number LIKE @q OR c.first_name || ' ' || c.last_name LIKE @q OR c.company LIKE @q)`);
      args.q = `%${req.query.q}%`;
    }
    res.json(db.prepare(`SELECT i.*, TRIM(c.first_name || ' ' || c.last_name) AS customer_name, c.company, c.email AS customer_email,
        (i.status = 'sent' AND i.due_date < @today) AS overdue
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.issue_date DESC, i.id DESC LIMIT 1000`).all(args));
  });

  r.get('/invoices/:id', P, (req, res) => res.json(loadFull(Number(req.params.id))));

  // Contracts that would be billed by a run through the given date.
  r.get('/billing/preview', P, (req, res) => {
    const s = getSettings(db);
    const through = isDate(req.query.through) ? req.query.through : addDays(today(), parseInt(s.billingLeadDays || '10', 10));
    const rows = db.prepare(`SELECT k.id, k.billing_cycle, k.rate_cents, k.next_bill_date, TRIM(c.first_name || ' ' || c.last_name) AS customer_name,
        c.company, s.label AS spot_label
      FROM contracts k JOIN customers c ON c.id = k.customer_id LEFT JOIN spots s ON s.id = k.spot_id
      WHERE k.status = 'active' AND k.next_bill_date <= ? AND (k.end_date IS NULL OR k.end_date = '' OR k.next_bill_date <= k.end_date)
      ORDER BY k.next_bill_date`).all(through);
    res.json({ through, contracts: rows });
  });

  r.post('/billing/run', P, (req, res) => {
    const through = isDate(req.body?.through) ? req.body.through : undefined;
    const out = runBilling(db, { throughDate: through, userId: req.user.id });
    res.json({ through: out.through, created: out.created.length, ids: out.created.map(Number) });
  });

  // Manual invoice (repairs, extra fees, one-offs).
  const cleanItems = (items) => {
    if (!Array.isArray(items) || !items.length) throw httpError(400, 'Add at least one line.');
    return items.filter((it) => it && String(it.description || '').trim()).map((it) => {
      const qty = parseFloat(it.qty) || 1;
      const unit = Math.round(parseFloat(String(it.unit ?? '0').replace(/[$,]/g, '')) * 100) || 0;
      return { description: String(it.description).trim(), qty, unit_cents: unit, amount_cents: Math.round(qty * unit) };
    });
  };
  const writeItems = (invoiceId, items) => {
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, amount_cents) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) ins.run(invoiceId, it.description, it.qty, it.unit_cents, it.amount_cents);
    recalcTotal(db, invoiceId);
  };

  r.post('/invoices', P, (req, res) => {
    const b = req.body || {};
    const cust = db.prepare('SELECT id FROM customers WHERE id = ?').get(Number(b.customer_id));
    if (!cust) throw httpError(400, 'Pick a customer.');
    const items = cleanItems(b.items);
    if (!items.length) throw httpError(400, 'Add at least one line with a description.');
    const s = getSettings(db);
    const issue = isDate(b.issue_date) ? b.issue_date : today();
    const due = isDate(b.due_date) ? b.due_date : addDays(issue, parseInt(s.paymentTermsDays || '15', 10));
    let id;
    db.transaction(() => {
      id = db.prepare(`INSERT INTO invoices (number, customer_id, issue_date, due_date, notes, status) VALUES (?, ?, ?, ?, ?, 'draft')`)
        .run(nextInvoiceNumber(db), cust.id, issue, due, b.notes || '').lastInsertRowid;
      writeItems(id, items);
    })();
    const inv = db.prepare('SELECT number FROM invoices WHERE id = ?').get(id);
    logActivity(db, 'invoice', `Invoice ${inv.number} created`, { customerId: cust.id, userId: req.user.id });
    res.json({ id: Number(id) });
  });

  r.put('/invoices/:id', P, (req, res) => {
    const { invoice } = loadFull(Number(req.params.id));
    if (['paid', 'void'].includes(invoice.status)) throw httpError(400, 'Paid or void invoices can’t be edited.');
    const b = req.body || {};
    db.transaction(() => {
      db.prepare('UPDATE invoices SET issue_date = ?, due_date = ?, notes = ? WHERE id = ?').run(
        isDate(b.issue_date) ? b.issue_date : invoice.issue_date,
        isDate(b.due_date) ? b.due_date : invoice.due_date,
        b.notes ?? invoice.notes, invoice.id);
      if (b.items) writeItems(invoice.id, cleanItems(b.items));
    })();
    res.json({ ok: true });
  });

  // PDF for printing. ?ids=1,2,3 prints several at once.
  r.get('/invoices-pdf', P, wrap(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) throw httpError(400, 'No invoices selected.');
    const list = ids.map(loadFull);
    const pdf = await invoicesPdf(list, getSettings(db));
    res.set('Content-Type', 'application/pdf');
    const fname = ids.length === 1 ? `Invoice-${list[0].invoice.number}.pdf` : `Invoices-${today()}.pdf`;
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fname}"`);
    res.send(pdf);
  }));

  const markSent = (inv, via, userId) => {
    if (inv.status === 'draft') db.prepare(`UPDATE invoices SET status = 'sent' WHERE id = ?`).run(inv.id);
    db.prepare(`UPDATE invoices SET sent_at = datetime('now'), sent_via = ? WHERE id = ?`).run(via, inv.id);
    logActivity(db, 'invoice', `Invoice ${inv.number} ${via === 'email' ? 'emailed' : 'marked as mailed/handed out'}`, { customerId: inv.customer_id, userId });
  };

  async function emailOne(id, userId) {
    const full = loadFull(id);
    const { invoice, customer } = full;
    if (invoice.status === 'void') throw httpError(400, 'Invoice is void.');
    if (!customer.email) throw httpError(400, `${nameOf(customer)} has no email address.`);
    const s = getSettings(db);
    const pdf = await invoicesPdf([full], s);
    await sendMail(s, {
      to: customer.email,
      subject: `Invoice ${invoice.number} from ${s.name}`,
      text: `Hi ${customer.first_name || nameOf(customer)},\n\nAttached is invoice ${invoice.number} for ${money(invoice.total_cents)}, due ${usDate(invoice.due_date)}.\n\n` +
        `If you have any questions, just reply to this email${s.phone ? ' or call ' + s.phone : ''}.\n\nThank you,\n${s.name}`,
      attachments: [{ filename: `Invoice-${invoice.number}.pdf`, content: pdf }],
    });
    markSent(invoice, 'email', userId);
  }

  r.post('/invoices/:id/email', P, wrap(async (req, res) => {
    await emailOne(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  }));

  // Send every draft: emails the ones with an address, returns the rest for printing.
  r.post('/invoices/send-drafts', P, wrap(async (req, res) => {
    const drafts = db.prepare(`SELECT i.id, c.email FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'draft' ORDER BY i.id`).all();
    const emailed = [], toPrint = [], failed = [];
    for (const d of drafts) {
      if (!d.email) { toPrint.push(d.id); continue; }
      try { await emailOne(d.id, req.user.id); emailed.push(d.id); }
      catch (e) { failed.push({ id: d.id, error: e.message }); if (/not set up/i.test(e.message)) { toPrint.push(...drafts.filter((x) => x.email && !emailed.includes(x.id)).map((x) => x.id)); break; } }
    }
    res.json({ emailed: emailed.length, toPrint: [...new Set(toPrint)], failed });
  }));

  r.post('/invoices/mark-sent', P, (req, res) => {
    const ids = (req.body?.ids || []).map(Number);
    for (const id of ids) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      if (inv && inv.status !== 'void' && inv.status !== 'paid') markSent(inv, 'print', req.user.id);
    }
    res.json({ ok: true });
  });

  r.post('/invoices/:id/paid', P, (req, res) => {
    const { invoice } = loadFull(Number(req.params.id));
    if (invoice.status === 'void') throw httpError(400, 'Invoice is void.');
    const date = isDate(req.body?.date) ? req.body.date : today();
    const method = String(req.body?.method || '').slice(0, 60);
    db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_method = ? WHERE id = ?`).run(date, method, invoice.id);
    logActivity(db, 'payment', `Payment received: ${invoice.number} ${money(invoice.total_cents)}${method ? ' (' + method + ')' : ''}`, { customerId: invoice.customer_id, userId: req.user.id });
    res.json({ ok: true });
  });

  r.post('/invoices/:id/unpaid', P, (req, res) => {
    const { invoice } = loadFull(Number(req.params.id));
    db.prepare(`UPDATE invoices SET status = CASE WHEN sent_at IS NULL THEN 'draft' ELSE 'sent' END, paid_at = NULL, paid_method = NULL WHERE id = ?`).run(invoice.id);
    res.json({ ok: true });
  });

  r.post('/invoices/:id/void', P, (req, res) => {
    const { invoice } = loadFull(Number(req.params.id));
    if (invoice.status === 'paid') throw httpError(400, 'Mark it unpaid first.');
    db.prepare(`UPDATE invoices SET status = 'void' WHERE id = ?`).run(invoice.id);
    logActivity(db, 'invoice', `Invoice ${invoice.number} voided`, { customerId: invoice.customer_id, userId: req.user.id });
    res.json({ ok: true });
  });

  return r;
};
