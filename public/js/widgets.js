// Reusable notes + photos panels for customers, spots and incidents.
import { get, post, put, del, api, esc, when, icon, toast, fail, sheet, confirmSheet } from './ui.js';
import { state, can } from './app.js';

export function notesPanel(container, entityType, entityId, initial) {
  const el = document.createElement('div');
  el.className = 'card';
  container.appendChild(el);
  const me = state.session.user;
  const canEdit = can('customers.edit');

  async function render(list) {
    if (!list) list = await get(`/notes?entity_type=${entityType}&entity_id=${entityId}`);
    el.innerHTML = `<div class="card-head"><h3>Notes</h3><span class="muted small">${list.length || ''}</span></div>
      ${canEdit ? `<form class="note-form"><textarea name="body" placeholder="Add a note…" aria-label="New note"></textarea><button class="btn primary" type="submit">Add</button></form>` : ''}
      <div>${list.length ? list.map((n) => `<div class="note" data-id="${n.id}"><p>${esc(n.body)}</p>
        <div class="meta"><span>${esc(n.author || 'Someone')} · ${when(n.created_at)}</span>
        ${(n.author_id === me.id || ['admin', 'owner'].includes(me.role)) ? `<button class="btn ghost sm" data-del="${n.id}" aria-label="Delete note" style="min-height:24px;padding:0 6px;color:var(--ink-3)">Delete</button>` : ''}</div></div>`).join('')
        : '<div class="empty">No notes yet.</div>'}</div>`;
    const f = el.querySelector('form');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const body = f.body.value.trim();
      if (!body) return;
      try { await post('/notes', { entity_type: entityType, entity_id: entityId, body }); await render(); toast('Note added'); } catch (err) { fail(err); }
    };
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!(await confirmSheet('Delete note?', 'This note will be removed.', 'Delete', true))) return;
      try { await del(`/notes/${b.dataset.del}`); await render(); } catch (err) { fail(err); }
    });
  }
  render(initial);
  return el;
}

export function photosPanel(container, entityType, entityId, initial, title = 'Photos & files') {
  const el = document.createElement('div');
  el.className = 'card';
  container.appendChild(el);
  const canEdit = can('customers.edit');

  async function render(list) {
    if (!list) list = await get(`/attachments?entity_type=${entityType}&entity_id=${entityId}`);
    el.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3><span class="muted small">${list.length || ''}</span></div>
      <div class="photos">
        ${canEdit ? `<label class="photo add">${icon.camera}<span>Add</span><input type="file" accept="image/*,application/pdf" multiple hidden></label>` : ''}
        ${list.map((a) => a.mime && a.mime.startsWith('image/')
          ? `<button class="photo" data-id="${a.id}" aria-label="${esc(a.caption || a.original_name)}"><img loading="lazy" src="/api/attachments/${a.id}/file" alt="${esc(a.caption || '')}"></button>`
          : `<a class="photo" href="/api/attachments/${a.id}/file" target="_blank" rel="noopener"><span class="pdf">PDF<br>${esc(a.original_name || '')}</span></a>`).join('')}
      </div>
      ${!list.length && !canEdit ? '<div class="empty">Nothing uploaded.</div>' : ''}`;
    const input = el.querySelector('input[type=file]');
    if (input) input.onchange = async () => {
      if (!input.files.length) return;
      const fd = new FormData();
      fd.append('entity_type', entityType);
      fd.append('entity_id', entityId);
      for (const f of input.files) fd.append('files', f);
      toast('Uploading…');
      try { await api('POST', '/attachments', fd); await render(); toast('Uploaded'); } catch (err) { fail(err); }
    };
    el.querySelectorAll('button.photo').forEach((b) => b.onclick = () => lightbox(list.find((a) => a.id === Number(b.dataset.id)), render));
  }
  render(initial);
  return el;
}

function lightbox(a, refresh) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<div class="bar">
      <div class="cap">${esc(a.caption || '')}<div class="small" style="opacity:.7">${esc(a.uploaded_by_name || '')} · ${when(a.created_at)}</div></div>
      ${can('customers.edit') ? `<button class="btn sm" data-cap>${icon.edit} Caption</button><button class="btn sm" data-del>${icon.trash}</button>` : ''}
      <button class="btn sm" data-x aria-label="Close">${icon.x}</button></div>
    <img src="/api/attachments/${a.id}/file" alt="${esc(a.caption || '')}">`;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('[data-x]').onclick = close;
  const cap = box.querySelector('[data-cap]');
  if (cap) cap.onclick = () => {
    const s = sheet({
      title: 'Caption',
      body: `<label class="field"><span>Caption</span><input name="caption" value="${esc(a.caption || '')}"></label>`,
      buttons: [{ label: 'Save', kind: 'primary', onClick: async (c) => {
        await put(`/attachments/${a.id}`, { caption: s.body.querySelector('input').value });
        c(); close(); refresh();
      } }],
    });
  };
  const d = box.querySelector('[data-del]');
  if (d) d.onclick = async () => {
    if (!(await confirmSheet('Delete photo?', 'This photo will be permanently removed.', 'Delete', true))) return;
    try { await del(`/attachments/${a.id}`); close(); refresh(); } catch (err) { fail(err); }
  };
  document.body.appendChild(box);
}
