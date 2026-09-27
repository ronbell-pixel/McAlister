// Resolves which storage company this server instance runs for.
// Every company lives in its own folder under /companies/<slug>/ with its own
// company.json (defaults), database and uploaded files, so one codebase can
// run any number of fully separate storage businesses.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const COMPANIES_DIR = process.env.COMPANIES_DIR || path.join(ROOT, 'companies');

function companySlug() {
  return (process.env.COMPANY || 'mcalister-storage').trim();
}

function companyPaths(slug = companySlug()) {
  const base = path.join(COMPANIES_DIR, slug);
  // DATA_DIR lets a host (e.g. a mounted volume) keep the database outside the code folder.
  const dataDir = process.env.DATA_DIR || path.join(base, 'data');
  return {
    base,
    configFile: path.join(base, 'company.json'),
    dataDir,
    dbFile: path.join(dataDir, 'storage.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    tmpDir: path.join(dataDir, 'tmp'),
    secretFile: path.join(dataDir, '.session-secret'),
  };
}

function loadCompanyDefaults(slug = companySlug()) {
  const p = companyPaths(slug);
  if (!fs.existsSync(p.configFile)) {
    throw new Error(
      `No company folder found for "${slug}". Create one with: npm run new-company -- "Company Name"`
    );
  }
  return JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
}

function ensureDirs(p) {
  for (const d of [p.dataDir, p.uploadsDir, p.tmpDir]) fs.mkdirSync(d, { recursive: true });
}

function sessionSecret(p) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(p.secretFile)) return fs.readFileSync(p.secretFile, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(p.secretFile, s, { mode: 0o600 });
  return s;
}

module.exports = { ROOT, COMPANIES_DIR, companySlug, companyPaths, loadCompanyDefaults, ensureDirs, sessionSecret };
