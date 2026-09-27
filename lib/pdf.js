// Printable / emailable invoice PDF.
const PDFDocument = require('pdfkit');

const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${m}/${d}/${y}`;
}

// Draws one invoice on the current page.
function drawInvoice(doc, inv, items, customer, company) {
    const brand = /^#[0-9a-f]{6}$/i.test(company.brandColor || '') ? company.brandColor : '#0b5c8a';
    const W = doc.page.width - 108;

    // Header band
    doc.rect(0, 0, doc.page.width, 8).fill(brand);
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(20).text(company.name || 'Storage Company', 54, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    const addr = [company.address, [company.city, company.state].filter(Boolean).join(', ') + (company.zip ? ' ' + company.zip : '')]
      .filter((x) => x && x.trim());
    let y = 66;
    for (const line of [company.tagline, ...addr, company.phone, company.email, company.website].filter(Boolean)) {
      doc.text(line, 54, y); y += 13;
    }

    doc.font('Helvetica-Bold').fontSize(24).fillColor(brand).text('INVOICE', 54, 40, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#333');
    const meta = [
      ['Invoice #', inv.number],
      ['Issue date', usDate(inv.issue_date)],
      ['Due date', usDate(inv.due_date)],
    ];
    let my = 72;
    for (const [k, v] of meta) {
      doc.fillColor('#777').text(k, 54, my, { width: W - 110, align: 'right' });
      doc.fillColor('#111').text(v, 54, my, { width: W, align: 'right' });
      my += 14;
    }

    // Bill to
    y = Math.max(y, my) + 24;
    doc.fillColor('#777').fontSize(9).text('BILL TO', 54, y);
    y += 14;
    doc.fillColor('#111').fontSize(11).font('Helvetica-Bold')
      .text([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || '', 54, y);
    doc.font('Helvetica').fontSize(10);
    y += 15;
    for (const line of [customer.company && (customer.first_name || customer.last_name) ? customer.company : null,
      customer.address,
      [customer.city, customer.state].filter(Boolean).join(', ') + (customer.zip ? ' ' + customer.zip : ''),
      customer.email].filter((x) => x && x.trim())) {
      doc.text(line, 54, y); y += 13;
    }

    // Items table
    y += 20;
    doc.rect(54, y, W, 22).fill('#f1f4f7');
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIPTION', 62, y + 7);
    doc.text('QTY', 54 + W - 190, y + 7, { width: 40, align: 'right' });
    doc.text('RATE', 54 + W - 140, y + 7, { width: 60, align: 'right' });
    doc.text('AMOUNT', 54 + W - 78, y + 7, { width: 70, align: 'right' });
    y += 30;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    for (const it of items) {
      const h = doc.heightOfString(it.description, { width: W - 210 });
      doc.text(it.description, 62, y, { width: W - 210 });
      doc.text(String(it.qty), 54 + W - 190, y, { width: 40, align: 'right' });
      doc.text(money(it.unit_cents), 54 + W - 140, y, { width: 60, align: 'right' });
      doc.text(money(it.amount_cents), 54 + W - 78, y, { width: 70, align: 'right' });
      y += Math.max(h, 14) + 10;
      doc.moveTo(54, y - 5).lineTo(54 + W, y - 5).strokeColor('#e3e7eb').lineWidth(0.75).stroke();
    }

    // Total
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111');
    doc.text('Total due', 54 + W - 220, y, { width: 130, align: 'right' });
    doc.fillColor(brand).text(money(inv.total_cents), 54 + W - 88, y, { width: 80, align: 'right' });
    if (inv.status === 'paid') {
      y += 22;
      doc.fillColor('#1b7f3b').fontSize(11).text(`PAID ${usDate(inv.paid_at?.slice(0, 10))}${inv.paid_method ? ' · ' + inv.paid_method : ''}`, 54, y, { width: W, align: 'right' });
    }

    if (inv.notes) {
      y += 36;
      doc.fillColor('#777').font('Helvetica').fontSize(9).text('NOTES', 54, y);
      doc.fillColor('#111').fontSize(10).text(inv.notes, 54, y + 13, { width: W });
    }

    // Footer
    doc.font('Helvetica').fontSize(9).fillColor('#777')
      .text(company.invoiceFooter || '', 54, doc.page.height - 90, { width: W, align: 'center', lineBreak: false });
}

// One or many invoices -> one PDF (one invoice per page), for printing or email.
function invoicesPdf(list, company) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const x of list) {
      doc.addPage();
      drawInvoice(doc, x.invoice, x.items, x.customer, company);
    }
    doc.end();
  });
}

module.exports = { invoicesPdf, money, usDate };
