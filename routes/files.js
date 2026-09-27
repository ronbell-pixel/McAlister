// Photos and documents attached to customers, spots and incidents.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { requirePerm, httpError } = require('../lib/auth');

const TYPES = ['customer', 'spot', 'incident'];
const ALLOWED = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

module.exports = ({ db, paths }) => {
  const r = express.Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: paths.uploadsDir,
      filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
        cb(null, crypto.randomBytes(16).toString('hex') + ext);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => cb(null, ALLOWED.test(file.mimetype)),
  });

  r.get('/attachments', requirePerm('customers.view'), (req, res) => {
    const { entity_type, entity_id } = req.query;
    if (!TYPES.includes(entity_type)) throw httpError(400, 'Bad target.');
    res.json(db.prepare(`SELECT a.id, a.original_name, a.mime, a.caption, a.created_at, u.name AS uploaded_by_name
      FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC`)
      .all(entity_type, Number(entity_id)));
  });

  r.post('/attachments', requirePerm('customers.edit'), upload.array('files', 10), (req, res) => {
    const { entity_type, entity_id, caption } = req.body || {};
    if (!TYPES.includes(entity_type) || !Number(entity_id)) {
      for (const f of req.files || []) fs.rm(f.path, () => {});
      throw httpError(400, 'Bad target.');
    }
    if (!req.files || !req.files.length) throw httpError(400, 'Choose a photo or PDF.');
    const ins = db.prepare('INSERT INTO attachments (entity_type, entity_id, filename, original_name, mime, caption, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const ids = req.files.map((f) => ins.run(entity_type, Number(entity_id), f.filename, f.originalname, f.mimetype, caption || '', req.user.id).lastInsertRowid);
    res.json({ ids });
  });

  // Files are only served to signed-in users.
  r.get('/attachments/:id/file', requirePerm('customers.view'), (req, res) => {
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!a) throw httpError(404, 'File not found.');
    res.set('Content-Type', a.mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${(a.original_name || 'file').replace(/[^\w.\- ]/g, '_')}"`);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(paths.uploadsDir, path.basename(a.filename)));
  });

  r.put('/attachments/:id', requirePerm('customers.edit'), (req, res) => {
    db.prepare('UPDATE attachments SET caption = ? WHERE id = ?').run(String(req.body?.caption || ''), req.params.id);
    res.json({ ok: true });
  });

  r.delete('/attachments/:id', requirePerm('customers.edit'), (req, res) => {
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!a) throw httpError(404, 'File not found.');
    if (a.uploaded_by !== req.user.id && !['admin', 'owner'].includes(req.user.role)) throw httpError(403, 'Only the uploader or an owner can delete this.');
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    fs.rm(path.join(paths.uploadsDir, path.basename(a.filename)), () => {});
    res.json({ ok: true });
  });

  return r;
};
