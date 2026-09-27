// Boat storage management app — server entry point.
// Run a specific company with:  COMPANY=<folder-name> npm start
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const { companySlug, companyPaths, loadCompanyDefaults, ensureDirs, sessionSecret } = require('./lib/company');
const { openDb } = require('./lib/db');

const slug = companySlug();
const paths = companyPaths(slug);
ensureDirs(paths);
const db = openDb(paths.dbFile, loadCompanyDefaults(slug));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieSession({
  name: `sid-${slug}`,
  secret: sessionSecret(paths),
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // stay signed in on phones for 30 days
}));

// Basic hardening headers.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

const ctx = { db, paths, slug };
let agreementsPublic = (req, res, next) => next();
// Public signing API (no login) — must come before the signed-in API.
app.use('/api/public', (req, res, next) => agreementsPublic(req, res, next));
app.use('/api', require('./lib/auth').loadUser(db));
// Remember the public web address for links in emails/texts.
app.use('/api', (req, res, next) => {
  if (req.user && !process.env.PUBLIC_URL) {
    const { getSettings, setSetting } = require('./lib/db');
    const url = `${req.protocol}://${req.get('host')}`;
    if (getSettings(db).publicUrl !== url && !/localhost|127\.0\.0\.1/.test(url)) setSetting(db, 'publicUrl', url);
  }
  next();
});
app.use('/api', require('./routes/auth')(ctx));
app.use('/api', require('./routes/setup')(ctx));
app.use('/api', require('./routes/customers')(ctx));
app.use('/api', require('./routes/invoices')(ctx));
app.use('/api', require('./routes/incidents')(ctx));
app.use('/api', require('./routes/files')(ctx));
app.use('/api', require('./routes/dashboard')(ctx));
app.use('/api', require('./routes/waitlist')(ctx));
app.use('/api', require('./routes/reminders')(ctx));
const agreements = require('./routes/agreements')(ctx);
app.use('/api', agreements.r);
agreementsPublic = agreements.pub;
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Home-screen app manifest, named and colored for this company.
app.get('/manifest.webmanifest', (req, res) => {
  const s = require('./lib/db').getSettings(db);
  res.type('application/manifest+json').json({
    name: s.name, short_name: (s.name || 'Storage').slice(0, 20), start_url: '/', display: 'standalone',
    background_color: '#f4f6f8', theme_color: s.brandColor || '#0b5c8a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));
app.get(/^\/sign\/[a-f0-9]+$/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'sign.html')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Errors come back as JSON with a readable message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500);
  if (status >= 500) console.error(err);
  let msg = err.expose || status < 500 ? err.message : 'Something went wrong. Please try again.';
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') msg = 'That already exists.';
  res.status(status).json({ error: msg });
});

const port = parseInt(process.env.PORT || '3000', 10);
require('./lib/reminders').startScheduler(db);
app.listen(port, () => {
  console.log(`${slug} running at http://localhost:${port}`);
});
