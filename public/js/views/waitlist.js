import { get, post, put, del, esc, date, when, icon, toast, fail, sheet, confirmSheet, fields, formData, fullName } from '../ui.js';
import { main, can, state, withLoc, multiLocation, clearQuery } from '../app.js';

const STATUS = { waiting: ['Waiting', 'warn'], offered: ['Offered', 'brand'], placed: ['Placed', 'good'], removed: ['Removed', ''] };

export async function waitlistPage() {
  let show = 'active';
  main().innerHTML = `
    <div class="page-head"><h1>Waitlist</h1><div class="actions">${can('customers.edit') ? `<button class="btn primary" id="add">${icon.plus} Add to waitlist</button>` : ''}</div></div>
    <p class="muted small" style="margin:-8px 0 14px">People waiting for a spot, in the order they signed up. Vacant spots on the Spots board show who fits.</p>
    <div class="segmented" id="seg" style="margin-bottom:12px">${[['active', 'Waiting'], ['placed', 'Placed'], ['removed', 'Removed'], ['', 'All']].map(([v, l]) =>
      `<button data-v="${v}" class="${v === show ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;
  const listEl = document.getElementById('list');

  async function load() {
    const rows = await get(withLoc(`/waitlist?status=${show}`));
    listEl.innerHTML = rows.length ? `<ul class="list">${rows.map((w, i) => `<li><div class="item" data-id="${w.id}" style="cursor:pointer">
        ${show === 'active' ? `<div class="avatar" style="font-size:13px">#${i + 1}</div>` : ''}
        <div class="main"><div class="title">${esc(w.customer_name || w.name)}</div>
          <div class="sub">${esc([w.boat_length_ft ? `${w.boat_length_ft} ft boat` : '', w.spot_type_name, multiLocation() ? w.location_name || 'Any location' : '', w.wanted_by ? `by ${date(w.wanted_by)}` : ''].filter(Boolean).join(' · ') || 'Any spot')}</div>
          <div class="sub">Added ${when(w.created_at)}${w.phone ? ' · ' + esc(w.phone) : ''}</div></div>
        <span class="badge ${STATUS[w.status][1]}">${STATUS[w.status][0]}</span>
        ${icon.chevron.replace('<svg', '<svg class="chev"')}</div></li>`).join('')}</ul>`
      : `<div class="empty">${show === 'active' ? 'Nobody is waiting.' : 'Nothing here.'}</div>`;
    listEl.querySelectorAll('[data-id]').forEach((el) => el.onclick = () => entrySheet(rows.find((w) => w.id === Number(el.dataset.id)), load));
  }
  document.getElementById('seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    show = b.dataset.v;
    document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(fail);
  };
  const add = document.getElementById('add');
  if (add) add.onclick = () => entryForm(null, load);
  await load();
  if (state.query.has('new')) { clearQuery(); entryForm(null, load); }
}

async function entryForm(w, reload) {
  const [types, locations] = await Promise.all([get('/spot-types'), multiLocation() ? get('/locations') : Promise.resolve([])]);
  const s = sheet({
    title: w ? 'Edit waitlist entry' : 'Add to waitlist',
    body: `<form class="grid2">${fields([
      { name: 'name', label: 'Name', full: true },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'boat_length_ft', label: 'Boat length (ft)', type: 'number' },
      { name: 'spot_type_id', label: 'Spot type wanted', type: 'select', options: [['', 'Any'], ...types.map((t) => [t.id, t.name])] },
      ...(locations.length > 1 ? [{ name: 'location_id', label: 'Location', type: 'select', options: [['', 'Any'], ...locations.map((l) => [l.id, l.name])] }] : []),
      { name: 'wanted_by', label: 'Needs it by (optional)', type: 'date' },
      ...(w ? [{ name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]]) }] : []),
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, full: true },
    ], w ? { ...w, name: w.name, boat_length_ft: w.boat_length_ft ?? '', spot_type_id: w.spot_type_id ?? '', location_id: w.location_id ?? '' } : { location_id: state.location })}</form>`,
    buttons: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: w ? 'Save' : 'Add', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (w) { await put(`/waitlist/${w.id}`, { ...w, ...v }); } else { await post('/waitlist', v); }
        close(); toast('Saved'); reload();
      } },
    ],
  });
}

function entrySheet(w, reload) {
  const editable = can('customers.edit');
  const s = sheet({
    title: w.customer_name || w.name,
    body: `<dl class="kv">
        <dt>Status</dt><dd><span class="badge ${STATUS[w.status][1]}">${STATUS[w.status][0]}</span></dd>
        <dt>Phone</dt><dd>${w.phone ? `<a href="tel:${esc(w.phone.replace(/[^\d+]/g, ''))}">${esc(w.phone)}</a>` : '—'}</dd>
        <dt>Email</dt><dd>${w.email ? `<a href="mailto:${esc(w.email)}">${esc(w.email)}</a>` : '—'}</dd>
        <dt>Wants</dt><dd>${esc([w.boat_length_ft ? `${w.boat_length_ft} ft boat` : '', w.spot_type_name || 'Any spot type', multiLocation() ? w.location_name || 'Any location' : ''].filter(Boolean).join(' · '))}</dd>
        ${w.wanted_by ? `<dt>Needs by</dt><dd>${date(w.wanted_by)}</dd>` : ''}
        <dt>Added</dt><dd>${date(w.created_at)}</dd>
        ${w.notes ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(w.notes)}</dd>` : ''}
        ${w.customer_id ? `<dt>Customer</dt><dd><a href="#/customers/${w.customer_id}" data-close>Open customer record</a></dd>` : ''}
      </dl>`,
    buttons: editable ? [
      { label: `${icon.trash}`, kind: 'ghost danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete entry?', 'Remove this person from the waitlist entirely? (Use Removed to keep a record.)', 'Delete', true))) return;
        await del(`/waitlist/${w.id}`); close(); reload();
      } },
      { label: `${icon.edit} Edit`, onClick: (close) => { close(); entryForm(w, reload); } },
      ...(w.status === 'waiting' || w.status === 'offered' ? [
        { label: 'Remove', onClick: async (close) => { await post(`/waitlist/${w.id}/status`, { status: 'removed' }); close(); toast('Removed from waitlist'); reload(); } },
        { label: w.customer_id ? 'Open customer' : `${icon.plus} Make customer`, kind: 'primary', onClick: async (close) => {
          const { customer_id } = await post(`/waitlist/${w.id}/customer`);
          close(); toast('Customer ready — assign them a spot'); location.hash = `#/customers/${customer_id}`;
        } },
      ] : []),
    ] : [],
  });
  s.body.querySelectorAll('[data-close]').forEach((a) => a.onclick = () => s.close());
}

// Used by the Spots board: who on the waitlist fits a vacant spot.
export async function matchesFor(spotId) {
  return get(`/waitlist/matches?spot_id=${spotId}`);
}
export { fullName };
