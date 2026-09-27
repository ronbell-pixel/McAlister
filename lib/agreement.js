// Rental agreements: default template, merge fields, and the signed PDF.
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const DEFAULT_TITLE = 'Boat Storage Agreement';

// Starter text only — the business should have its own attorney review it.
const DEFAULT_TEMPLATE = `This Boat Storage Agreement ("Agreement") is made on {{today}} between {{company_name}} ("Owner") and {{customer_name}} ("Customer").

1. SPACE. Owner rents to Customer storage space {{spot}} in {{building}}{{location_line}} (the "Space") for the vessel described below (the "Vessel"):
   {{boat}}{{registration_line}}

2. TERM. This Agreement begins on {{start_date}} and continues on a {{billing_cycle}} basis until ended by either party with written notice.

3. RENT. Customer agrees to pay {{rate}} per {{billing_period}}, due on or before the due date shown on each invoice. Late payments may be charged a late fee as posted by Owner.

4. INSURANCE. Customer will keep the Vessel insured at all times and provide proof of insurance on request. Owner does not insure the Vessel or its contents.

5. RISK OF LOSS. Customer stores the Vessel at Customer's own risk. Owner is not responsible for loss or damage caused by fire, theft, weather, vandalism, or other causes, except for Owner's gross negligence.

6. CONDITION OF VESSEL. Customer will keep the Vessel in safe condition, will not store fuel containers, hazardous materials or valuables in or around it, and will disconnect batteries unless Owner agrees otherwise.

7. ACCESS AND MOVING. Owner may enter the Space and move the Vessel when reasonably necessary for safety, maintenance, or operations.

8. NO ASSIGNMENT. Customer may not sublet the Space or store a different vessel without Owner's written approval.

9. DEFAULT. If rent is unpaid, Owner may deny access and exercise any lien rights allowed by state law.

10. ENDING STORAGE. Customer will remove the Vessel by the end date and leave the Space clean. A vessel left after the end date may be charged additional rent.

11. ENTIRE AGREEMENT. This Agreement, together with Owner's posted rules, is the entire agreement between the parties.

By signing below, Customer agrees to the terms of this Agreement and agrees to sign electronically.`;

const CYCLE = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const PERIOD = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };

const money = (c) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usDate = (s) => (s ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : '');

function mergeFields(db, contractId, customerId, settings) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const k = contractId ? db.prepare(`SELECT k.*, s.label AS spot, b.name AS building, l.name AS location
      FROM contracts k LEFT JOIN spots s ON s.id = k.spot_id LEFT JOIN buildings b ON b.id = s.building_id
      LEFT JOIN locations l ON l.id = b.location_id WHERE k.id = ?`).get(contractId) : null;
  const boat = k && k.boat_id ? db.prepare('SELECT * FROM boats WHERE id = ?').get(k.boat_id)
    : db.prepare('SELECT * FROM boats WHERE customer_id = ? ORDER BY id LIMIT 1').get(customerId);
  const today = new Date().toISOString().slice(0, 10);
  const boatDesc = boat ? [boat.year, boat.make, boat.model, boat.length_ft ? `${boat.length_ft} ft` : '', boat.name ? `"${boat.name}"` : ''].filter(Boolean).join(' ') : 'As listed on Customer’s account';
  return {
    today: usDate(today),
    company_name: settings.name || '',
    company_phone: settings.phone || '',
    customer_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '',
    customer_email: c.email || '',
    customer_phone: c.phone || '',
    customer_address: [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' '),
    spot: k && k.spot ? k.spot : '(to be assigned)',
    building: k && k.building ? k.building : 'the storage facility',
    location: k && k.location ? k.location : '',
    location_line: k && k.location ? `, ${k.location}` : '',
    boat: boatDesc,
    registration: boat && boat.registration ? boat.registration : '',
    registration_line: boat && boat.registration ? `, registration ${boat.registration}` : '',
    start_date: k ? usDate(k.start_date) : usDate(today),
    end_date: k && k.end_date ? usDate(k.end_date) : '',
    billing_cycle: k ? (CYCLE[k.billing_cycle] || '').toLowerCase() : 'monthly',
    billing_period: k ? PERIOD[k.billing_cycle] : 'month',
    rate: k ? money(k.rate_cents) : '(to be set)',
  };
}

function render(template, fields) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in fields ? fields[key] : m));
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Signed copy: agreement text, signature, and an audit trail page.
function signedPdf(ag, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const brand = /^#[0-9a-f]{6}$/i.test(settings.brandColor || '') ? settings.brandColor : '#0b5c8a';
    const W = doc.page.width - 120;

    doc.rect(0, 0, doc.page.width, 8).fill(brand);
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(16).text(settings.name || '', 60, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#666')
      .text([settings.address, [settings.city, settings.state].filter(Boolean).join(', '), settings.zip, settings.phone].filter(Boolean).join(' · '), 60, 56);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(brand).text(ag.title, 60, doc.y, { width: W });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10.5).fillColor('#111').text(ag.body, { width: W, lineGap: 2 });

    doc.moveDown(1.5);
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#444').text('CUSTOMER SIGNATURE');
    const sigY = doc.y + 6;
    try {
      const png = Buffer.from(String(ag.signature_png).split(',')[1] || '', 'base64');
      doc.image(png, 60, sigY, { fit: [240, 80] });
    } catch { /* signature image missing */ }
    doc.moveTo(60, sigY + 86).lineTo(320, sigY + 86).strokeColor('#999').stroke();
    doc.font('Helvetica').fontSize(10).fillColor('#111').text(ag.signer_name || '', 60, sigY + 92);
    doc.fillColor('#666').fontSize(9).text(`Signed electronically ${new Date(ag.signed_at + 'Z').toLocaleString('en-US', { timeZone: settings.timezone || 'America/Chicago' })}`, 60, sigY + 106);

    // Audit trail
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text('Signature record');
    doc.moveDown(0.6);
    const rows = [
      ['Document', ag.title],
      ['Signed by', ag.signer_name],
      ['Sent', `${ag.sent_at} UTC${ag.sent_via ? ` (by ${ag.sent_via === 'sms' ? 'text' : ag.sent_via})` : ' (in person)'}`],
      ['First opened', ag.viewed_at ? `${ag.viewed_at} UTC` : ''],
      ['Signed', `${ag.signed_at} UTC`],
      ['IP address', ag.signer_ip || ''],
      ['Device', ag.signer_ua || ''],
      ['Document fingerprint (SHA-256)', ag.body_sha256],
      ['Reference', `Agreement #${ag.id}`],
    ];
    doc.fontSize(10);
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fillColor('#555').text(k, 60, y, { width: 170 });
      doc.font('Helvetica').fillColor('#111').text(String(v || '—'), 240, y, { width: W - 180 });
      doc.moveDown(0.5);
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#666').text('The signer agreed to use an electronic signature. The fingerprint above changes if any word of the agreement text is altered.', 60, doc.y, { width: W });
    doc.end();
  });
}

module.exports = { DEFAULT_TITLE, DEFAULT_TEMPLATE, mergeFields, render, sha256, signedPdf };
