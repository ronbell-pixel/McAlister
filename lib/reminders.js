// Automatic reminders: payment due soon, overdue, insurance expiring, rental ending.
// Each reminder is logged so nothing is sent twice; overdue notices repeat on a schedule.
const { getSettings, setSetting, logActivity } = require('./db');
const { today, addDays } = require('./billing');
const { channelsFor, sendMail, sendSms } = require('./messaging');
const { invoicesPdf, money, usDate } = require('./pdf');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '';
const KIND_LABEL = { due_soon: 'Payment due soon', overdue: 'Payment overdue', insurance: 'Insurance expiring', ending: 'Rental ending' };

// Everything that is due to be sent right now.
function collect(db, s = getSettings(db)) {
  const t = today();
  const items = [];
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?');
  const sentCount = db.prepare(`SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM reminder_log WHERE kind = ? AND ref_key = ? AND status = 'sent'`);
  const phone = s.phone ? ` Questions? Call ${s.phone}.` : '';

  const add = (kind, ref_key, customer, msg) => {
    if (!customer || customer.status === 'inactive' || customer.reminders_ok === 0) return;
    items.push({ kind, label: KIND_LABEL[kind], ref_key, customer_id: customer.id, customer_name: fullName(customer),
      channels: channelsFor(customer, s), ...msg });
  };

  // 1. Invoices coming due
  const dueDays = int(s.reminderDueDays, 3);
  if (dueDays > 0) {
    for (const i of db.prepare(`SELECT * FROM invoices WHERE status = 'sent' AND due_date >= ? AND due_date <= ?`).all(t, addDays(t, dueDays))) {
      const key = `inv:${i.id}`;
      if (sentCount.get('due_soon', key).n) continue;
      const c = cust.get(i.customer_id);
      add('due_soon', key, c, {
        invoice_id: i.id, detail: `${i.number} · ${money(i.total_cents)} due ${usDate(i.due_date)}`,
        subject: `Reminder: invoice ${i.number} is due ${usDate(i.due_date)}`,
        text: `Hi ${c.first_name || fullName(c)},\n\nThis is a friendly reminder that invoice ${i.number} for ${money(i.total_cents)} is due on ${usDate(i.due_date)}. A copy is attached.\n\nIf you've already paid, thank you — please ignore this note.${phone}\n\n${s.name}`,
        sms: `${s.name}: reminder, invoice ${i.number} for ${money(i.total_cents)} is due ${usDate(i.due_date)}.${phone}`,
      });
    }
  }

  // 2. Overdue invoices (repeat every N days, up to a maximum)
  const odDays = int(s.reminderOverdueDays, 3), repeat = int(s.reminderOverdueRepeatDays, 7), max = int(s.reminderOverdueMax, 3);
  if (max > 0) {
    for (const i of db.prepare(`SELECT * FROM invoices WHERE status = 'sent' AND due_date <= ?`).all(addDays(t, -odDays))) {
      const key = `inv:${i.id}`;
      const prior = sentCount.get('overdue', key);
      if (prior.n >= max) continue;
      if (prior.last && prior.last.slice(0, 10) > addDays(t, -repeat)) continue;
      const c = cust.get(i.customer_id);
      const final = prior.n + 1 === max;
      add('overdue', key, c, {
        invoice_id: i.id, detail: `${i.number} · ${money(i.total_cents)} was due ${usDate(i.due_date)}${prior.n ? ` · notice ${prior.n + 1} of ${max}` : ''}`,
        subject: `${final ? 'Final notice' : 'Past due'}: invoice ${i.number}`,
        text: `Hi ${c.first_name || fullName(c)},\n\nOur records show invoice ${i.number} for ${money(i.total_cents)} was due on ${usDate(i.due_date)} and is still unpaid. A copy is attached. Please arrange payment at your earliest convenience.${final ? '\n\nThis is our final automated notice.' : ''}\n\nIf you've already paid, thank you — please ignore this note.${phone}\n\n${s.name}`,
        sms: `${s.name}: invoice ${i.number} (${money(i.total_cents)}) was due ${usDate(i.due_date)} and is past due. Please arrange payment.${phone}`,
      });
    }
  }

  // 3. Boat insurance expiring (or recently expired)
  const insDays = int(s.reminderInsuranceDays, 30);
  if (insDays > 0) {
    for (const b of db.prepare(`SELECT b.* FROM boats b JOIN customers c ON c.id = b.customer_id
        WHERE b.insurance_expires IS NOT NULL AND b.insurance_expires != '' AND b.insurance_expires <= ? AND b.insurance_expires >= ?
        AND EXISTS (SELECT 1 FROM contracts k WHERE k.customer_id = c.id AND k.status = 'active')`).all(addDays(t, insDays), addDays(t, -30))) {
      const key = `boat:${b.id}:${b.insurance_expires}`;
      if (sentCount.get('insurance', key).n) continue;
      const c = cust.get(b.customer_id);
      const boat = [b.name, b.make, b.model].filter(Boolean).join(' ') || 'your boat';
      const past = b.insurance_expires < t;
      add('insurance', key, c, {
        detail: `${boat} · ${past ? 'expired' : 'expires'} ${usDate(b.insurance_expires)}`,
        subject: `Insurance ${past ? 'expired' : 'renewal'} reminder for ${boat}`,
        text: `Hi ${c.first_name || fullName(c)},\n\nOur records show the insurance on ${boat} ${past ? 'expired' : 'expires'} on ${usDate(b.insurance_expires)}. Please send us a copy of your renewed policy (a photo of the declarations page is fine).${phone}\n\nThank you,\n${s.name}`,
        sms: `${s.name}: insurance on ${boat} ${past ? 'expired' : 'expires'} ${usDate(b.insurance_expires)}. Please send us your renewed policy.`,
      });
    }
  }

  // 4. Rentals ending soon
  const endDays = int(s.reminderEndingDays, 30);
  if (endDays > 0) {
    for (const k of db.prepare(`SELECT k.*, s.label AS spot FROM contracts k LEFT JOIN spots s ON s.id = k.spot_id
        WHERE k.status = 'active' AND k.end_date IS NOT NULL AND k.end_date != '' AND k.end_date >= ? AND k.end_date <= ?`).all(t, addDays(t, endDays))) {
      const key = `contract:${k.id}:${k.end_date}`;
      if (sentCount.get('ending', key).n) continue;
      const c = cust.get(k.customer_id);
      add('ending', key, c, {
        detail: `${k.spot ? 'Spot ' + k.spot + ' · ' : ''}ends ${usDate(k.end_date)}`,
        subject: `Your storage ${k.spot ? `(spot ${k.spot}) ` : ''}ends ${usDate(k.end_date)}`,
        text: `Hi ${c.first_name || fullName(c)},\n\nYour storage${k.spot ? ` in spot ${k.spot}` : ''} is scheduled to end on ${usDate(k.end_date)}. If you'd like to renew, just reply to this email and we'll take care of it. Otherwise, please plan to pick up your boat by that date.${phone}\n\nThank you,\n${s.name}`,
        sms: `${s.name}: your storage${k.spot ? ` (spot ${k.spot})` : ''} ends ${usDate(k.end_date)}. Reply or call to renew.`,
      });
    }
  }
  return items;
}

async function run(db, { userId = null } = {}) {
  const s = getSettings(db);
  const items = collect(db, s);
  const log = db.prepare('INSERT INTO reminder_log (kind, ref_key, customer_id, channel, status, detail) VALUES (?, ?, ?, ?, ?, ?)');
  const result = { sent: 0, failed: 0, skipped: 0, items: [] };
  for (const it of items) {
    if (!it.channels.length) { result.skipped++; result.items.push({ ...it, outcome: 'No email or text-OK phone' }); continue; }
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(it.customer_id);
    const outcomes = [];
    for (const ch of it.channels) {
      try {
        if (ch === 'email') {
          let attachments;
          if (it.invoice_id) {
            const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(it.invoice_id);
            const items2 = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(it.invoice_id);
            attachments = [{ filename: `Invoice-${inv.number}.pdf`, content: await invoicesPdf([{ invoice: inv, items: items2, customer: c }], s) }];
          }
          await sendMail(s, { to: c.email, subject: it.subject, text: it.text, attachments });
        } else {
          await sendSms(s, { to: c.phone, body: it.sms });
        }
        log.run(it.kind, it.ref_key, it.customer_id, ch, 'sent', it.detail);
        outcomes.push(ch === 'sms' ? 'texted' : 'emailed');
        result.sent++;
      } catch (e) {
        log.run(it.kind, it.ref_key, it.customer_id, ch, 'failed', e.message);
        outcomes.push(`${ch} failed: ${e.message}`);
        result.failed++;
      }
    }
    logActivity(db, 'reminder', `${it.label} reminder ${outcomes.join(', ')}`, { customerId: it.customer_id, userId });
    result.items.push({ ...it, outcome: outcomes.join(', ') });
  }
  return result;
}

// Runs once a day at the configured local hour when reminders are switched on.
function startScheduler(db) {
  const tick = async () => {
    try {
      const s = getSettings(db);
      if (s.remindersEnabled !== 'true') return;
      const tz = s.timezone || 'America/Chicago';
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).map((p) => [p.type, p.value]));
      const localDate = `${parts.year}-${parts.month}-${parts.day}`;
      if (Number(parts.hour) < int(s.reminderHour, 9) || s.lastReminderRun === localDate) return;
      setSetting(db, 'lastReminderRun', localDate);
      const r = await run(db);
      console.log(`reminders ${localDate}: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`);
    } catch (e) { console.error('reminder run failed:', e); }
  };
  setTimeout(tick, 30 * 1000);
  return setInterval(tick, 15 * 60 * 1000);
}

module.exports = { collect, run, startScheduler, KIND_LABEL };
