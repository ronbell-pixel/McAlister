// Removes notes and uploaded files that belong to a deleted record.
const fs = require('fs');
const path = require('path');

function removeChildren(db, uploadsDir, entityType, entityId) {
  const files = db.prepare('SELECT filename FROM attachments WHERE entity_type = ? AND entity_id = ?').all(entityType, entityId);
  db.prepare('DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  db.prepare('DELETE FROM notes WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  for (const f of files) fs.rm(path.join(uploadsDir, path.basename(f.filename)), () => {});
}

module.exports = { removeChildren };
