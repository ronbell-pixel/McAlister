import { get, post, put, del, api, esc, date, icon, toast, fail, sheet, confirmSheet, fields, formData, fullName, today } from '../ui.js';
import { main, can, state, clearQuery } from '../app.js';
import { notesPanel, photosPanel } from '../widgets.js';

const CATS = [['incident', 'Incident (boat / customer)'], ['equipment', 'Equipment'], ['facility', 'Facility']];
const catLabel = { incident: 'Incident', equipment: 'Equipment', facility: 'Facility' };

export async function incidentList() {
  let status = 'open';
  let cat = '';
  main().innerHTML = `
    <div class="page-head"><h1>Incident log</h1><div class="actions"><button class="btn primary" id="new">${icon.camera} Log something</button></div></div>
    <p class="muted small" style="margin:-8px 0 14px">Damage, incidents, equipment repairs and facility issues — with photos.</p>
    <div class="row" style="margin-bottom:12px">
      <div class="segmented" id="seg">${[['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']].map(([v, l]) => `<button data-v="${v}" class="${v === status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="cat" style="width:auto;min-height:40px" aria-label="Category"><option value="">All types</option>${CATS.map(([v]) => `<option value="${v}">${catLabel[v]}</option>`).join('')}</select>
    </div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;
  const listEl = document.getElementById('list');
  async function load() {
    const rows = await get(`/incidents?status=${status}&category=${cat}`);
    listEl.innerHTML = rows.length ? `<ul class="list">${rows.map((i) => `<li><a class="item" href="#/log/${i.id}">
      <div class="main"><div class="title">${esc(i.title)}</div>
      <div class="sub">${date(i.occurred_on)} · ${catLabel[i.category]}${i.customer_name ? ' · ' + esc(i.customer_name) : ''}${i.spot_label ? ' · Spot ' + esc(i.spot_label) : ''}${i.photo_count ? ` · ${i.photo_count} photo${i.photo_count === 1 ? '' : 's'}` : ''}</div></div>
      <span class="badge ${i.status === 'open' ? 'warn' : 'good'}">${i.status === 'open' ? 'Open' : 'Resolved'}</span>
      ${icon.chevron.replace('<svg', '<svg class="chev"')}</a></li>`).join('')}</ul>` : '<div class="empty">Nothing logged here.</div>';
  }
  document.getElementById('seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    status = b.dataset.v;
    document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(fail);
  };
  document.getElementById('cat').onchange = (e) => { cat = e.target.value; load().catch(fail); };
  document.getElementById('new').onclick = () => incidentForm();
  await load();
  if (state.query.has('new')) { clearQuery(); incidentForm(); }
}

async function incidentForm(i = null, onSaved) {
  const [customers, spots] = await Promise.all([get('/customers?status='), get('/spots')]);
  const s = sheet({
    title: i ? 'Edit entry' : 'Log incident or issue',
    body: `<form class="grid2">${fields([
      { name: 'title', label: 'What happened?', full: true, placeholder: 'e.g. Scratch on hull during move' },
      { name: 'category', label: 'Type', type: 'select', options: CATS },
      { name: 'occurred_on', label: 'Date', type: 'date', value: today() },
      { name: 'customer_id', label: 'Customer (optional)', type: 'select', options: [['', '—'], ...customers.map((c) => [c.id, fullName(c)])] },
      { name: 'spot_id', label: 'Spot (optional)', type: 'select', options: [['', '—'], ...spots.map((x) => [x.id, `${x.building} · ${x.label}`])] },
      { name: 'description', label: 'Details', type: 'textarea', full: true, rows: 4 },
      ...(i ? [
        { name: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['resolved', 'Resolved']] },
        { name: 'resolution', label: 'Resolution', type: 'textarea', full: true, rows: 2 },
      ] : []),
    ], i || {})}
    ${i ? '' : `<label class="field" style="grid-column:1/-1"><span>Photos</span><input type="file" name="photos" accept="image/*,application/pdf" multiple><small>Take pictures now or add more later.</small></label>`}
    </form>`,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        delete v.photos;
        if (i) { await put(`/incidents/${i.id}`, v); close(); toast('Saved'); onSaved && onSaved(); return; }
        const { id } = await post('/incidents', v);
        const files = s.body.querySelector('input[type=file]').files;
        if (files.length) {
          const fd = new FormData();
          fd.append('entity_type', 'incident'); fd.append('entity_id', id);
          for (const f of files) fd.append('files', f);
          toast('Uploading photos…');
          await api('POST', '/attachments', fd);
        }
        close(); toast('Logged');
        location.hash = `#/log/${id}`;
      } },
    ],
  });
  // Pre-select a customer when logging from a customer page.
  const pre = state.query.get('customer');
  if (pre && !i) s.body.querySelector('[name=customer_id]').value = pre;
}

export async function incidentDetail(id) {
  const i = await get(`/incidents/${id}`);
  main().innerHTML = `
    <a class="back" href="#/log">${icon.back} Incident log</a>
    <div class="card pad" style="margin-bottom:16px">
      <div class="spread" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:220px"><h1 style="font-size:22px">${esc(i.title)}</h1>
          <div class="row small muted" style="margin-top:6px;gap:8px">
            <span class="badge ${i.status === 'open' ? 'warn' : 'good'}">${i.status === 'open' ? 'Open' : 'Resolved'}</span>
            <span>${catLabel[i.category]} · ${date(i.occurred_on)}</span>
            ${i.created_by_name ? `<span>by ${esc(i.created_by_name)}</span>` : ''}</div></div>
        <div class="row">
          ${i.status === 'open' ? `<button class="btn" id="resolve">${icon.check} Resolve</button>` : ''}
          <button class="btn" id="edit">${icon.edit} Edit</button>
        </div>
      </div>
      <dl class="kv" style="margin-top:14px">
        ${i.customer_id ? `<dt>Customer</dt><dd><a href="#/customers/${i.customer_id}">${esc(i.customer_name)}</a></dd>` : ''}
        ${i.spot_label ? `<dt>Spot</dt><dd>${esc(i.spot_label)}</dd>` : ''}
        ${i.description ? `<dt>Details</dt><dd style="white-space:pre-wrap">${esc(i.description)}</dd>` : ''}
        ${i.resolution ? `<dt>Resolution</dt><dd style="white-space:pre-wrap">${esc(i.resolution)}</dd>` : ''}
      </dl>
    </div>
    <div class="detail-grid"><div class="stack" id="a"></div><div class="stack" id="b"></div></div>
    ${can('customers.delete') ? `<div style="margin-top:24px;text-align:center"><button class="btn ghost danger" id="delete">${icon.trash} Delete entry</button></div>` : ''}`;
  photosPanel(document.getElementById('a'), 'incident', id, undefined, 'Photos');
  notesPanel(document.getElementById('b'), 'incident', id);
  const reload = () => incidentDetail(id).catch(fail);
  document.getElementById('edit').onclick = () => incidentForm(i, reload);
  const r = document.getElementById('resolve');
  if (r) r.onclick = () => {
    const s = sheet({
      title: 'Resolve',
      body: fields([{ name: 'resolution', label: 'What was done?', type: 'textarea', rows: 3, value: i.resolution }]),
      buttons: [{ label: 'Cancel', onClick: (c) => c() }, { label: `${icon.check} Mark resolved`, kind: 'primary', onClick: async (c) => {
        await put(`/incidents/${id}`, { ...i, status: 'resolved', resolution: s.body.querySelector('textarea').value }); c(); toast('Resolved'); reload();
      } }],
    });
  };
  const d = document.getElementById('delete');
  if (d) d.onclick = async () => {
    if (!(await confirmSheet('Delete entry?', 'This removes the entry. Photos stay in storage until cleaned up.', 'Delete', true))) return;
    try { await del(`/incidents/${id}`); location.hash = '#/log'; } catch (e) { fail(e); }
  };
}
