// Sign in / out, first-run admin creation, and user management.
const express = require('express');
const bcrypt = require('bcryptjs');
const { getSettings } = require('../lib/db');
const { permissionsFor, requireLogin, requirePerm, httpError, wrap } = require('../lib/auth');
const { isConfigured } = require('../lib/mailer');

const ROLES = ['admin', 'owner', 'user'];

module.exports = ({ db }) => {
  const r = express.Router();
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // Simple in-memory brute-force protection: 8 failed tries per email+IP per 15 minutes.
  const fails = new Map();
  const tooMany = (key) => {
    const f = fails.get(key);
    return f && f.count >= 8 && Date.now() - f.first < 15 * 60 * 1000;
  };
  const recordFail = (key) => {
    const f = fails.get(key);
    if (!f || Date.now() - f.first > 15 * 60 * 1000) fails.set(key, { count: 1, first: Date.now() });
    else f.count++;
  };

  function publicCompany() {
    const s = getSettings(db);
    return { name: s.name, tagline: s.tagline, brandColor: s.brandColor };
  }

  r.get('/session', (req, res) => {
    const s = getSettings(db);
    res.json({
      company: publicCompany(),
      needsFirstAdmin: userCount() === 0,
      user: req.user ? { ...req.user, permissions: permissionsFor(req.user.role) } : null,
      features: { email: isConfigured(s), stripe: s.stripeEnabled === 'true' },
    });
  });

  function validPassword(p) {
    if (typeof p !== 'string' || p.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  }

  // Only works when the database has no users yet (brand-new install).
  r.post('/first-admin', wrap(async (req, res) => {
    if (userCount() > 0) throw httpError(403, 'Setup is already complete.');
    const { name, email, password } = req.body || {};
    if (!name || !email) throw httpError(400, 'Name and email are required.');
    validPassword(password);
    const hash = await bcrypt.hash(password, 11);
    const id = db.prepare(`INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)`)
      .run(email.trim(), name.trim(), hash).lastInsertRowid;
    req.session.uid = Number(id);
    res.json({ ok: true });
  }));

  r.post('/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const key = `${String(email).toLowerCase()}|${req.ip}`;
    if (tooMany(key)) throw httpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    const ok = u && u.active && (await bcrypt.compare(String(password || ''), u.password_hash));
    if (!ok) { recordFail(key); throw httpError(401, 'Email or password is incorrect.'); }
    fails.delete(key);
    db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(u.id);
    req.session.uid = u.id;
    res.json({ ok: true });
  }));

  r.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

  r.post('/me/password', requireLogin, wrap(async (req, res) => {
    const { current, next } = req.body || {};
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw httpError(400, 'Current password is incorrect.');
    validPassword(next);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(next, 11), req.user.id);
    res.json({ ok: true });
  }));

  // --- User management (admin) ---
  r.get('/users', requirePerm('users'), (req, res) => {
    res.json(db.prepare('SELECT id, email, name, role, active, created_at, last_login FROM users ORDER BY name').all());
  });

  r.post('/users', requirePerm('users'), wrap(async (req, res) => {
    const { name, email, role, password } = req.body || {};
    if (!name || !email) throw httpError(400, 'Name and email are required.');
    if (!ROLES.includes(role)) throw httpError(400, 'Pick a role.');
    validPassword(password);
    const id = db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(email.trim(), name.trim(), role, await bcrypt.hash(password, 11)).lastInsertRowid;
    res.json({ id });
  }));

  r.put('/users/:id', requirePerm('users'), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw httpError(404, 'User not found.');
    const { name, email, role, active, password } = req.body || {};
    if (role && !ROLES.includes(role)) throw httpError(400, 'Invalid role.');
    const nextRole = role || u.role;
    const nextActive = active == null ? u.active : (active ? 1 : 0);
    // Never lock out the last active admin.
    if (u.role === 'admin' && (nextRole !== 'admin' || !nextActive)) {
      const admins = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get().n;
      if (admins <= 1) throw httpError(400, 'There must be at least one active admin.');
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
      .run(name ?? u.name, email ?? u.email, nextRole, nextActive, id);
    if (password) {
      validPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 11), id);
    }
    res.json({ ok: true });
  }));

  return r;
};
