// Setup: company details, email, buildings, spots, pricing, spreadsheet import.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { getSettings, setSetting, SETTING_KEYS } = require('../lib/db');
const { requirePerm, requireLogin, httpError, wrap, can } = require('../lib/auth');
const importer = require('../lib/importer');
const { sendMail } = require('../lib/mailer');
const { removeChildren } = require('../lib/cleanup');
const { locSql } = require('../lib/locations');

const SECRET_KEYS = ['smtpPass', 'stripeSecretKey', 'twilioToken'];
const cents = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

module.exports = ({ db, paths }) => {
  const r = express.Router();

  // ---- Company settings ----
  r.get('/settings', requirePerm('setup'), (req, res) => {
    const s = getSettings(db);
    const out = {};
    for (const k of SETTING_KEYS) out[k] = SECRET_KEYS.includes(k) ? '' : (s[k] ?? '');
    for (const k of SECRET_KEYS) out[`${k}Set`] = Boolean(s[k]);
    out.nextInvoiceNumber = s.nextInvoiceNumber;
    res.json(out);
  });

  r.put('/settings', requirePerm('setup'), (req, res) => {
    const body = req.body || {};
    const tx = db.transaction(() => {
      for (const k of SETTING_KEYS) {
        if (!(k in body)) continue;
        // Blank secret fields mean "keep the saved one".
        if (SECRET_KEYS.includes(k) && !body[k]) continue;
        if (k === 'brandColor' && body[k] && !/^#[0-9a-f]{6}$/i.test(body[k])) throw httpError(400, 'Brand color must look like #0b5c8a.');
        setSetting(db, k, body[k]);
      }
      if (body.nextInvoiceNumber && /^\d+$/.test(String(body.nextInvoiceNumber))) setSetting(db, 'nextInvoiceNumber', body.nextInvoiceNumber);
    });
    tx();
    res.json({ ok: true });
  });

  r.post('/settings/test-sms', requirePerm('setup'), wrap(async (req, res) => {
    const { sendSms } = require('../lib/sms');
    if (!req.body?.to) throw httpError(400, 'Enter a mobile number to test with.');
    await sendSms(getSettings(db), { to: req.body.to, body: `Test text from ${getSettings(db).name}. Texting is working.` });
    res.json({ ok: true });
  }));

  r.post('/settings/test-email', requirePerm('setup'), wrap(async (req, res) => {
    await sendMail(getSettings(db), {
      to: req.body.to || req.user.email,
      subject: 'Test email from your storage app',
      text: 'Email is working. Invoices can now be sent by email.',
    });
    res.json({ ok: true });
  }));

  // ---- Locations ----
  r.get('/locations', requireLogin, (req, res) => {
    res.json(db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM buildings b WHERE b.location_id = l.id) AS building_count
      FROM locations l ORDER BY l.sort, l.name COLLATE NOCASE`).all());
  });
  const locArgs = (b) => {
    if (!b.name || !String(b.name).trim()) throw httpError(400, 'Location name is required.');
    return [String(b.name).trim(), b.address || '', b.city || '', b.state || '', b.zip || '', b.phone || ''];
  };
  r.post('/locations', requirePerm('setup'), (req, res) => {
    const id = db.prepare('INSERT INTO locations (name, address, city, state, zip, phone) VALUES (?, ?, ?, ?, ?, ?)').run(...locArgs(req.body || {})).lastInsertRowid;
    // The first location adopts every building that has none, so nothing is left out.
    if (db.prepare('SELECT COUNT(*) AS n FROM locations').get().n === 1) db.prepare('UPDATE buildings SET location_id = ? WHERE location_id IS NULL').run(id);
    res.json({ id });
  });
  r.put('/locations/:id', requirePerm('setup'), (req, res) => {
    db.prepare('UPDATE locations SET name = ?, address = ?, city = ?, state = ?, zip = ?, phone = ? WHERE id = ?').run(...locArgs(req.body || {}), req.params.id);
    res.json({ ok: true });
  });
  r.delete('/locations/:id', requirePerm('setup'), (req, res) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM buildings WHERE location_id = ?').get(req.params.id).n;
    if (n) throw httpError(400, `Move or delete its ${n} building(s) first.`);
    db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- Buildings ----
  r.get('/buildings', requirePerm('spots.view'), (req, res) => {
    const f = locSql(req);
    res.json(db.prepare(`SELECT b.*, l.name AS location_name, (SELECT COUNT(*) FROM spots s WHERE s.building_id = b.id AND s.active = 1) AS spot_count
      FROM buildings b LEFT JOIN locations l ON l.id = b.location_id WHERE 1=1${f.sql}
      ORDER BY l.sort, l.name, b.sort, b.name`).all());
  });
  const bldArgs = (b) => {
    if (!b.name || !String(b.name).trim()) throw httpError(400, 'Building name is required.');
    return [String(b.name).trim(), b.location || '', b.notes || '', b.location_id ? Number(b.location_id) : null];
  };
  r.post('/buildings', requirePerm('setup'), (req, res) => {
    res.json({ id: db.prepare('INSERT INTO buildings (name, location, notes, location_id) VALUES (?, ?, ?, ?)').run(...bldArgs(req.body || {})).lastInsertRowid });
  });
  r.put('/buildings/:id', requirePerm('setup'), (req, res) => {
    db.prepare('UPDATE buildings SET name = ?, location = ?, notes = ?, location_id = ? WHERE id = ?').run(...bldArgs(req.body || {}), req.params.id);
    res.json({ ok: true });
  });
  r.delete('/buildings/:id', requirePerm('setup'), (req, res) => {
    const inUse = db.prepare(`SELECT COUNT(*) AS n FROM contracts c JOIN spots s ON s.id = c.spot_id WHERE s.building_id = ? AND c.status = 'active'`).get(req.params.id).n;
    if (inUse) throw httpError(400, `This building has ${inUse} rented spot(s). End those rentals first.`);
    const id = Number(req.params.id);
    db.transaction(() => {
      for (const s of db.prepare('SELECT id FROM spots WHERE building_id = ?').all(id)) removeChildren(db, paths.uploadsDir, 'spot', s.id);
      db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  });

  // ---- Pricing (spot types) ----
  r.get('/spot-types', requirePerm('spots.view'), (req, res) => {
    const rows = db.prepare('SELECT * FROM spot_types ORDER BY name').all();
    if (!can(req.user, 'rates.view')) rows.forEach((t) => { delete t.monthly_cents; delete t.quarterly_cents; delete t.yearly_cents; });
    res.json(rows);
  });
  const typeArgs = (b) => {
    if (!b.name) throw httpError(400, 'Name is required.');
    return [b.name.trim(), b.description || '', cents(b.monthly), cents(b.quarterly), cents(b.yearly)];
  };
  r.post('/spot-types', requirePerm('setup'), (req, res) => {
    res.json({ id: db.prepare('INSERT INTO spot_types (name, description, monthly_cents, quarterly_cents, yearly_cents) VALUES (?, ?, ?, ?, ?)').run(...typeArgs(req.body || {})).lastInsertRowid });
  });
  r.put('/spot-types/:id', requirePerm('setup'), (req, res) => {
    db.prepare('UPDATE spot_types SET name = ?, description = ?, monthly_cents = ?, quarterly_cents = ?, yearly_cents = ? WHERE id = ?').run(...typeArgs(req.body || {}), req.params.id);
    res.json({ ok: true });
  });
  r.delete('/spot-types/:id', requirePerm('setup'), (req, res) => {
    db.prepare('DELETE FROM spot_types WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- Spots (with who is in each one) ----
  r.get('/spots', requirePerm('spots.view'), (req, res) => {
    const f = locSql(req);
    const rows = db.prepare(`SELECT s.*, b.name AS building, b.location_id, l.name AS location_name, t.name AS type_name,
        c.id AS contract_id, c.customer_id, c.rate_cents, c.billing_cycle,
        TRIM(cu.first_name || ' ' || cu.last_name) AS customer_name,
        bo.name AS boat_name, bo.make AS boat_make, bo.model AS boat_model
      FROM spots s
      JOIN buildings b ON b.id = s.building_id
      LEFT JOIN locations l ON l.id = b.location_id
      LEFT JOIN spot_types t ON t.id = s.spot_type_id
      LEFT JOIN contracts c ON c.spot_id = s.id AND c.status = 'active'
      LEFT JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN boats bo ON bo.id = c.boat_id
      WHERE 1=1${f.sql}
      ORDER BY l.sort, l.name COLLATE NOCASE, b.sort, b.name COLLATE NOCASE`).all();
    // Natural order within each building: A-2 before A-10.
    const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const bOrder = new Map();
    rows.forEach((x) => { if (!bOrder.has(x.building_id)) bOrder.set(x.building_id, bOrder.size); });
    rows.sort((a, b) => bOrder.get(a.building_id) - bOrder.get(b.building_id) || coll.compare(a.label, b.label));
    if (!can(req.user, 'rates.view')) rows.forEach((x) => { delete x.rate_cents; });
    res.json(rows);
  });

  const spotArgs = (b) => [b.spot_type_id || null, b.length_ft || null, b.width_ft || null, b.notes || '', b.active === false ? 0 : 1];

  // Add one spot, or a range like prefix "A-" from 1 to 20.
  r.post('/spots', requirePerm('setup'), (req, res) => {
    const b = req.body || {};
    if (!b.building_id) throw httpError(400, 'Pick a building.');
    const labels = [];
    if (b.rangeFrom != null && b.rangeTo != null && b.rangeFrom !== '' && b.rangeTo !== '') {
      const from = parseInt(b.rangeFrom, 10), to = parseInt(b.rangeTo, 10);
      if (!(from >= 0 && to >= from && to - from < 500)) throw httpError(400, 'Range must be up to 500 spots.');
      for (let i = from; i <= to; i++) labels.push(`${b.prefix || ''}${i}`);
    } else if (b.label) labels.push(String(b.label).trim());
    else throw httpError(400, 'Enter a spot number or a range.');
    const ins = db.prepare('INSERT OR IGNORE INTO spots (building_id, label, spot_type_id, length_ft, width_ft, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let added = 0;
    db.transaction(() => { for (const l of labels) added += ins.run(b.building_id, l, ...spotArgs(b)).changes; })();
    res.json({ added, skipped: labels.length - added });
  });
  r.put('/spots/:id', requirePerm('setup'), (req, res) => {
    const b = req.body || {};
    if (!b.label) throw httpError(400, 'Spot number is required.');
    db.prepare('UPDATE spots SET building_id = ?, label = ?, spot_type_id = ?, length_ft = ?, width_ft = ?, notes = ?, active = ? WHERE id = ?')
      .run(b.building_id, String(b.label).trim(), ...spotArgs(b), req.params.id);
    res.json({ ok: true });
  });
  r.delete('/spots/:id', requirePerm('setup'), (req, res) => {
    const used = db.prepare(`SELECT 1 FROM contracts WHERE spot_id = ? AND status = 'active'`).get(req.params.id);
    if (used) throw httpError(400, 'This spot is rented. End the rental first.');
    const id = Number(req.params.id);
    db.transaction(() => { db.prepare('DELETE FROM spots WHERE id = ?').run(id); removeChildren(db, paths.uploadsDir, 'spot', id); })();
    res.json({ ok: true });
  });

  // ---- Spreadsheet import ----
  const upload = multer({
    dest: paths.tmpDir,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /\.(xlsx|csv)$/i.test(file.originalname)),
  });
  const pending = new Map(); // token -> { file, name, at }
  const cleanup = () => {
    for (const [t, p] of pending) if (Date.now() - p.at > 60 * 60 * 1000) { fs.rm(p.file, () => {}); pending.delete(t); }
  };

  r.get('/import/template', requirePerm('import'), wrap(async (req, res) => {
    const buf = await importer.templateWorkbook();
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
    res.send(Buffer.from(buf));
  }));

  r.post('/import/preview', requirePerm('import'), upload.single('file'), wrap(async (req, res) => {
    cleanup();
    if (!req.file) throw httpError(400, 'Choose an Excel (.xlsx) or CSV file.');
    let sheet;
    try { sheet = await importer.readSheet(req.file.path, req.file.originalname); }
    catch (e) { fs.rm(req.file.path, () => {}); throw httpError(400, `Couldn't read that file: ${e.message}`); }
    const token = crypto.randomBytes(16).toString('hex');
    pending.set(token, { file: req.file.path, name: req.file.originalname, at: Date.now() });
    res.json({
      token,
      fileName: req.file.originalname,
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 5),
      rowCount: sheet.rows.length,
      mapping: importer.suggestMapping(sheet.headers),
      fields: importer.FIELDS.map((f) => ({ key: f.key, label: f.label })),
    });
  }));

  r.post('/import/commit', requirePerm('import'), wrap(async (req, res) => {
    const { token, mapping } = req.body || {};
    const p = pending.get(token);
    if (!p) throw httpError(400, 'That upload expired. Please choose the file again.');
    if (!Array.isArray(mapping) || !mapping.some(Boolean)) throw httpError(400, 'Match at least one column.');
    const valid = new Set(importer.FIELDS.map((f) => f.key));
    const clean = mapping.map((k) => (valid.has(k) ? k : ''));
    const sheet = await importer.readSheet(p.file, p.name);
    const result = importer.commitImport(db, sheet, clean, { userId: req.user.id });
    fs.rm(p.file, () => {});
    pending.delete(token);
    res.json(result);
  }));

  return r;
};
