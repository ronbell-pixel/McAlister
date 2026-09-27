// Letter templates: warning, thank-you and other customer letters.
// Sent by email or printed on letterhead; every letter is saved to the customer's history.
const PDFDocument = require('pdfkit');
const { mergeFields, render } = require('./agreement');
const { money, usDate } = require('./pdf');
const { today } = require('./billing');

const DEFAULT_TEMPLATES = [
  { key: 'welcome', name: 'Welcome / thank you', category: 'thanks', subject: 'Welcome to {{company_name}}',
    body: `Dear {{first_name}},

Thank you for choosing {{company_name}} to store your boat. We're glad to have you.

Your space is {{spot}} in {{building}}{{location_line}}. Your rate is {{rate}} per {{billing_period}}, and invoices will be sent to you ahead of each billing period.

If you ever need access to your boat, have a question about your account, or notice anything we should know about, please call us at {{company_phone}}.

Thank you again for your business.` },
  { key: 'payment_thanks', name: 'Thank you for your payment', category: 'thanks', subject: 'Thank you for your payment',
    body: `Dear {{first_name}},

Thank you for your recent payment. Your account is in good standing, and we appreciate your prompt attention.

We look forward to continuing to store your boat. Please call us at {{company_phone}} if you ever need anything.` },
  { key: 'late_warning', name: 'Late payment warning', category: 'warning', subject: 'Past due balance on your storage account',
    body: `Dear {{first_name}},

Our records show a past due balance of {{balance_due}} on your storage account:

{{overdue_list}}

Please arrange payment within 10 days of the date of this letter. If you have already sent payment, thank you — please disregard this notice.

If there is a problem or you would like to set up a payment plan, please call us at {{company_phone}}. We're happy to work with you.` },
  { key: 'final_notice', name: 'Final notice', category: 'warning', subject: 'FINAL NOTICE: past due storage account',
    body: `Dear {{first_name}},

This is a final notice that your storage account has a past due balance of {{balance_due}}, unpaid since {{oldest_due_date}}:

{{overdue_list}}

Please pay the full balance within 10 days of the date of this letter. If the balance is not paid, we may deny access to your boat and take further action allowed under your storage agreement and state law.

If you believe this notice is in error or need to discuss your account, please call us right away at {{company_phone}}.` },
  { key: 'renewal', name: 'Storage renewal', category: 'notice', subject: 'Time to renew your boat storage',
    body: `Dear {{first_name}},

Your storage agreement for space {{spot}} is scheduled to end on {{end_date}}. We would be glad to keep storing your boat.

To renew at your current rate of {{rate}} per {{billing_period}}, simply reply to this letter or call us at {{company_phone}}. If you plan to remove your boat, please let us know your pickup date.

Thank you for storing with us.` },
  { key: 'pickup', name: 'Boat pickup reminder', category: 'notice', subject: 'Reminder: boat pickup',
    body: `Dear {{first_name}},

This is a reminder that your storage in space {{spot}} ends on {{end_date}}. Please plan to pick up your boat by that date, and remove any personal items from the space.

If you would like to extend your storage instead, call us at {{company_phone}} and we'll take care of it.` },
  { key: 'rate_change', name: 'Rate change notice', category: 'notice', subject: 'Notice of storage rate change',
    body: `Dear {{first_name}},

We are writing to let you know about an upcoming change to storage rates at {{company_name}}.

Beginning [DATE], the rate for your space {{spot}} will change from {{rate}} to [NEW RATE] per {{billing_period}}. This change helps us keep up with rising costs for insurance, maintenance and security.

We value your business. If you have any questions, please call us at {{company_phone}}.` },
  { key: 'general', name: 'General notice', category: 'notice', subject: 'An update from {{company_name}}',
    body: `Dear {{first_name}},

[Write your message here.]

Thank you,` },
];

// All merge fields for one customer: the agreement fields plus balance and overdue details.
function letterFields(db, customerId, settings, extra = {}) {
  const k = db.prepare(`SELECT id FROM contracts WHERE customer_id = ? ORDER BY status = 'active' DESC, id DESC LIMIT 1`).get(customerId);
  const f = mergeFields(db, k ? k.id : null, customerId, settings);
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const t = today();
  const open = db.prepare(`SELECT * FROM invoices WHERE customer_id = ? AND status = 'sent' ORDER BY due_date`).all(customerId);
  const overdue = open.filter((i) => i.due_date < t);
  return {
    ...f,
    first_name: c.first_name || f.customer_name,
    company_phone: settings.phone || 'the office',
    balance_due: money(open.reduce((a, i) => a + i.total_cents, 0)),
    overdue_total: money(overdue.reduce((a, i) => a + i.total_cents, 0)),
    overdue_list: overdue.length ? overdue.map((i) => `   Invoice ${i.number}, due ${usDate(i.due_date)}: ${money(i.total_cents)}`).join('\n') : '   (no past-due invoices)',
    oldest_due_date: overdue.length ? usDate(overdue[0].due_date) : '',
    end_date: f.end_date || '(no end date set)',
    portal_link: extra.portal_link || '',
  };
}

// Customers a bulk letter can go to.
const AUDIENCES = {
  active: { label: 'All active customers', sql: `SELECT id FROM customers c WHERE status = 'active'` },
  overdue: { label: 'Customers with past-due invoices', sql: `SELECT DISTINCT c.id FROM customers c JOIN invoices i ON i.customer_id = c.id WHERE i.status = 'sent' AND i.due_date < date('now', 'localtime')` },
  balance: { label: 'Customers with any open balance', sql: `SELECT DISTINCT c.id FROM customers c JOIN invoices i ON i.customer_id = c.id WHERE i.status = 'sent'` },
  ending: { label: 'Rentals ending in the next 60 days', sql: `SELECT DISTINCT c.id FROM customers c JOIN contracts k ON k.customer_id = c.id WHERE k.status = 'active' AND k.end_date IS NOT NULL AND k.end_date != '' AND k.end_date <= date('now', '+60 days')` },
  prospects: { label: 'Prospects', sql: `SELECT id FROM customers c WHERE status = 'prospect'` },
};

// Letters on letterhead, one per page (bulk printing puts them all in one PDF).
function lettersPdf(letters, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 60, left: 72, right: 72 }, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const brand = /^#[0-9a-f]{6}$/i.test(settings.brandColor || '') ? settings.brandColor : '#0b5c8a';
    for (const l of letters) {
      doc.addPage();
      const W = doc.page.width - 144;
      doc.rect(0, 0, doc.page.width, 8).fill(brand);
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(17).text(settings.name || '', 72, 40, { width: W });
      doc.font('Helvetica').fontSize(9).fillColor('#666').text([settings.address, [settings.city, settings.state].filter(Boolean).join(', ') + (settings.zip ? ' ' + settings.zip : ''), settings.phone, settings.email].filter((x) => x && x.trim()).join('  ·  '), { width: W });
      doc.moveTo(72, doc.y + 8).lineTo(72 + W, doc.y + 8).strokeColor('#dde3e8').lineWidth(1).stroke();
      doc.moveDown(2.2);
      doc.fillColor('#111').fontSize(11).text(usDate(l.date || today()));
      doc.moveDown(1.2);
      const c = l.customer;
      const addr = [[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company, c.first_name || c.last_name ? c.company : null, c.address,
        [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ')].filter((x) => x && String(x).trim());
      doc.text(addr.join('\n'));
      doc.moveDown(1.4);
      doc.font('Helvetica-Bold').text(`RE: ${l.subject}`);
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(11).text(l.body, { width: W, lineGap: 3 });
      doc.moveDown(1.6);
      doc.text('Sincerely,');
      doc.moveDown(2);
      doc.text(settings.name || '');
      if (settings.phone) doc.fillColor('#666').fontSize(10).text(settings.phone);
    }
    doc.end();
  });
}

module.exports = { DEFAULT_TEMPLATES, letterFields, render, AUDIENCES, lettersPdf };
