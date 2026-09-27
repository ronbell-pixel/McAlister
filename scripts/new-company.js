#!/usr/bin/env node
// Creates a new storage company folder so the same app can run another business.
// Usage: npm run new-company -- "Harbor Point Storage"
const fs = require('fs');
const path = require('path');
const { COMPANIES_DIR } = require('../lib/company');

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: npm run new-company -- "Company Name"');
  process.exit(1);
}
const slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dir = path.join(COMPANIES_DIR, slug);
if (fs.existsSync(dir)) {
  console.error(`A company folder already exists: companies/${slug}`);
  process.exit(1);
}
const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 3) || 'INV';
const config = {
  name,
  tagline: 'Boat Storage',
  address: '', city: '', state: '', zip: '', phone: '', email: '', website: '',
  brandColor: '#0b5c8a',
  invoicePrefix: `${initials}-`,
  invoiceStartNumber: 1001,
  paymentTermsDays: 15,
  invoiceFooter: `Thank you for storing with ${name}!`,
  billingLeadDays: 10,
};
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'company.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Created companies/${slug}/company.json`);
console.log(`Start it with:  COMPANY=${slug} npm start`);
console.log('The first person to open the app creates the admin account.');
