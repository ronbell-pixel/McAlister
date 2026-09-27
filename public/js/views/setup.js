import { get, post, put, del, api, esc, money, dollars, date, when, icon, toast, fail, sheet, confirmSheet, fields, formData } from '../ui.js';
import { main, state, roleName } from '../app.js';

async function refreshSession() { state.session = await get('/session'); }

const TABS = [
  ['company', 'Company'], ['spots', 'Locations & spots'], ['pricing', 'Pricing'],
  ['agreement', 'Agreement'], ['reminders', 'Reminders & late fees'], ['email', 'Email & texts'],
  ['users', 'Users'], ['import', 'Import'], ['payments', 'Payments & portal'],
];

export async function setup(tab = 'company') {
  if (!TABS.some(([k]) => k === tab)) tab = 'company';
  main().innerHTML = `<div class="page-head"><h1>Setup</h1></div>
    <div class="segmented setup-tabs" id="tabs">${TABS.map(([k, l]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pane"></div>`;
  document.getElementById('tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (b) location.hash = `#/setup/${b.dataset.k}`;
  };
  document.querySelector('#tabs .on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const pane = document.getElementById('pane');
  await ({ company, spots, pricing, users, import: importPane, email, payments, agreement, reminders })[tab](pane);
}

// ---------- Company ----------
async function company(pane) {
  const s = await get('/settings');
  pane.innerHTML = `<div class="card pad"><form class="grid2">
    ${fields([
      { name: 'name', label: 'Company name', full: true },
      { name: 'tagline', label: 'Tagline', placeholder: 'Boat & RV Storage' },
      { name: 'brandColor', label: 'Brand color', type: 'color' },
      { name: 'address', label: 'Street address', full: true },
      { name: 'city', label: 'City' }, { name: 'state', label: 'State' },
      { name: 'zip', label: 'ZIP' }, { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Reply-to email', type: 'email' }, { name: 'website', label: 'Website' },
    ], s)}
    <h3 style="grid-column:1/-1;margin:10px 0 12px">Invoices</h3>
    ${fields([
      { name: 'invoicePrefix', label: 'Invoice number prefix', hint: 'e.g. MS- gives MS-1001' },
      { name: 'nextInvoiceNumber', label: 'Next invoice number', type: 'number' },
      { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number', hint: 'Due date = invoice date + this many days' },
      { name: 'billingLeadDays', label: 'Bill ahead (days)', type: 'number', hint: 'Run billing creates invoices for periods starting within this many days' },
      { name: 'invoiceFooter', label: 'Invoice footer message', full: true },
    ], s)}
    <div style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button></div>
  </form></div>`;
  const f = pane.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await put('/settings', formData(f)); toast('Saved'); await refreshBrand(); } catch (err) { fail(err); }
  };
}

async function refreshBrand() {
  state.session = await get('/session');
  const c = state.session.company;
  document.documentElement.style.setProperty('--brand', c.brandColor);
  document.querySelectorAll('.sidebar .brand b, .topbar .brandname').forEach((el) => { el.textContent = c.name; });
  document.querySelectorAll('.sidebar .brand small').forEach((el) => { el.textContent = c.tagline || ''; });
  document.title = c.name;
}

// ---------- Buildings & spots ----------
async function spots(pane) {
  const [buildings, spotList, types, locations] = await Promise.all([get('/buildings'), get('/spots'), get('/spot-types'), get('/locations')]);
  const typeOpts = [['', '— No type —'], ...types.map((t) => [t.id, t.name])];
  pane.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Locations</h3>
        <div class="muted small">${locations.length > 1 ? 'Everyone can switch between locations from the menu.' : 'Only needed if you run more than one yard or site. Add a second location to turn on the location switcher.'}</div></div>
        <button class="btn sm" id="addL">${icon.plus} Add location</button></div>
      ${locations.length ? `<ul class="list">${locations.map((l) => `<li><div class="item" data-el="${l.id}" style="cursor:pointer"><div class="main"><div class="title">${esc(l.name)}</div>
        <div class="sub">${esc([l.address, [l.city, l.state].filter(Boolean).join(', '), l.phone].filter(Boolean).join(' · ') || 'No address')} · ${l.building_count} building${l.building_count === 1 ? '' : 's'}</div></div>
        ${icon.edit.replace('<svg', '<svg width="16" height="16" style="color:var(--ink-3)"')}</div></li>`).join('')}</ul>` : ''}</div>
    <div class="info">Set up each building or lot, then add the numbered spots inside it. Spot <b>types</b> (under Pricing) set the default price.</div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" id="addB">${icon.plus} Add building</button>
      ${buildings.length ? `<button class="btn" id="addS">${icon.plus} Add spots</button>` : ''}</div>
    <div class="stack">${buildings.length ? buildings.map((b) => {
      const list = spotList.filter((s) => s.building_id === b.id);
      return `<div class="card"><div class="card-head"><div><h3>${esc(b.name)}</h3><div class="muted small">${locations.length > 1 ? esc(b.location_name || 'No location') + ' · ' : ''}${esc(b.location || '')}${b.location ? ' · ' : ''}${list.length} spot${list.length === 1 ? '' : 's'}</div></div>
        <button class="btn sm" data-eb="${b.id}">${icon.edit} Edit</button></div>
        ${list.length ? `<div class="scroll-x"><table class="data"><thead><tr><th>Spot</th><th>Type</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>
          ${list.map((s) => `<tr class="click" data-es="${s.id}"><td><b>${esc(s.label)}</b></td><td>${esc(s.type_name || '—')}</td>
            <td class="muted">${[s.length_ft && s.length_ft + "'", s.width_ft && s.width_ft + "'"].filter(Boolean).join(' × ')}</td>
            <td>${s.contract_id ? `<span class="badge brand">${esc(s.customer_name)}</span>` : s.active ? '<span class="badge good">Vacant</span>' : '<span class="badge">Not in use</span>'}</td>
            <td class="r">${icon.edit.replace('<svg', '<svg width="16" height="16" style="color:var(--ink-3)"')}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">No spots yet.</div>'}</div>`;
    }).join('') : '<div class="card empty">No buildings yet. Add your first building or lot.</div>'}</div>`;

  const reload = () => spots(pane).catch(fail);
  pane.querySelector('#addB').onclick = () => buildingForm(null, reload, locations);
  pane.querySelectorAll('[data-eb]').forEach((b) => b.onclick = () => buildingForm(buildings.find((x) => x.id === Number(b.dataset.eb)), reload, locations));
  const reloadAll = async () => { await refreshSession(); location.reload(); };
  pane.querySelector('#addL').onclick = () => locationForm(null, locations.length ? reload : reloadAll, locations.length === 1 ? reloadAll : null);
  pane.querySelectorAll('[data-el]').forEach((r) => r.onclick = () => locationForm(locations.find((l) => l.id === Number(r.dataset.el)), reloadAll));
  const addS = pane.querySelector('#addS');
  if (addS) addS.onclick = () => addSpotsForm(buildings, typeOpts, reload);
  pane.querySelectorAll('[data-es]').forEach((r) => r.onclick = () => editSpotForm(spotList.find((s) => s.id === Number(r.dataset.es)), buildings, typeOpts, reload));
}

function locationForm(l, reload, reloadAfterAdd) {
  const s = sheet({
    title: l ? 'Edit location' : 'Add location',
    body: `<form class="grid2">${fields([
      { name: 'name', label: 'Location name', full: true, placeholder: 'Lake Ozark yard' },
      { name: 'address', label: 'Street address', full: true },
      { name: 'city', label: 'City' }, { name: 'state', label: 'State' },
      { name: 'zip', label: 'ZIP' }, { name: 'phone', label: 'Phone', type: 'tel' },
    ], l || {})}</form>
    ${!l ? '<p class="muted small">Your first location takes all existing buildings. After adding a second one, set each building’s location.</p>' : ''}`,
    buttons: [
      ...(l ? [{ label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete location?', `Delete ${l.name}? It must have no buildings.`, 'Delete', true))) return;
        await del(`/locations/${l.id}`); close(); reload();
      } }] : []),
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (l) await put(`/locations/${l.id}`, v); else await post('/locations', v);
        close(); toast('Saved'); (reloadAfterAdd && !l ? reloadAfterAdd : reload)();
      } },
    ],
  });
}

function buildingForm(b, reload, locations = []) {
  const s = sheet({
    title: b ? 'Edit building' : 'Add building',
    body: `<form>${fields([
      { name: 'name', label: 'Name', placeholder: 'Building A, North Lot…' },
      ...(locations.length ? [{ name: 'location_id', label: 'Location', type: 'select', options: [['', '—'], ...locations.map((l) => [l.id, l.name])] }] : []),
      { name: 'location', label: 'Description', placeholder: 'Heated, north side…' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ], b ? { ...b, location_id: b.location_id ?? '' } : { location_id: locations.length === 1 ? locations[0].id : (state.location || '') })}</form>`,
    buttons: [
      ...(b ? [{ label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete building?', `Deletes ${b.name} and all its spots.`, 'Delete', true))) return;
        await del(`/buildings/${b.id}`); close(); reload();
      } }] : []),
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (b) await put(`/buildings/${b.id}`, v); else await post('/buildings', v);
        close(); toast('Saved'); reload();
      } },
    ],
  });
}

function addSpotsForm(buildings, typeOpts, reload) {
  const s = sheet({
    title: 'Add spots',
    body: `<form>
      ${fields([{ name: 'building_id', label: 'Building', type: 'select', options: buildings.map((b) => [b.id, b.name]) }])}
      <div class="segmented" id="mode" style="margin-bottom:14px"><button type="button" data-m="range" class="on">Many at once</button><button type="button" data-m="one">One spot</button></div>
      <div id="range" class="grid3">${fields([
        { name: 'prefix', label: 'Prefix', placeholder: 'A-' },
        { name: 'rangeFrom', label: 'From #', type: 'number', value: 1 },
        { name: 'rangeTo', label: 'To #', type: 'number', value: 10 },
      ])}</div>
      <div id="one" class="hidden">${fields([{ name: 'label', label: 'Spot number / name' }])}</div>
      <div class="grid3">${fields([
        { name: 'spot_type_id', label: 'Type (sets price)', type: 'select', options: typeOpts },
        { name: 'length_ft', label: 'Length (ft)', type: 'number' },
        { name: 'width_ft', label: 'Width (ft)', type: 'number' },
      ])}</div>
      <p class="muted small" id="pv"></p>
    </form>`,
    buttons: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Add spots', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (mode === 'one') { delete v.rangeFrom; delete v.rangeTo; } else delete v.label;
        const r = await post('/spots', v);
        close(); toast(`${r.added} spot${r.added === 1 ? '' : 's'} added${r.skipped ? ` (${r.skipped} already existed)` : ''}`); reload();
      } },
    ],
  });
  let mode = 'range';
  const f = s.body.querySelector('form');
  const pv = () => {
    const a = parseInt(f.rangeFrom.value, 10), b = parseInt(f.rangeTo.value, 10);
    s.body.querySelector('#pv').textContent = mode === 'range' && a >= 0 && b >= a ? `Creates ${b - a + 1} spots: ${f.prefix.value}${a} … ${f.prefix.value}${b}` : '';
  };
  f.oninput = pv; pv();
  s.body.querySelector('#mode').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mode = b.dataset.m;
    s.body.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
    s.body.querySelector('#range').classList.toggle('hidden', mode !== 'range');
    s.body.querySelector('#one').classList.toggle('hidden', mode !== 'one');
    pv();
  };
}

function editSpotForm(sp, buildings, typeOpts, reload) {
  const s = sheet({
    title: `Spot ${sp.label}`,
    body: `<form class="grid2">${fields([
      { name: 'label', label: 'Spot number / name' },
      { name: 'building_id', label: 'Building', type: 'select', options: buildings.map((b) => [b.id, b.name]) },
      { name: 'spot_type_id', label: 'Type (sets price)', type: 'select', options: typeOpts },
      { name: 'length_ft', label: 'Length (ft)', type: 'number' },
      { name: 'width_ft', label: 'Width (ft)', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, full: true },
      { name: 'active', label: 'In use (uncheck to hide from rentals)', type: 'checkbox' },
    ], { ...sp, spot_type_id: sp.spot_type_id ?? '', active: Boolean(sp.active) })}</form>`,
    buttons: [
      { label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete spot?', `Delete spot ${sp.label}?`, 'Delete', true))) return;
        await del(`/spots/${sp.id}`); close(); reload();
      } },
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => { await put(`/spots/${sp.id}`, formData(s.body)); close(); toast('Saved'); reload(); } },
    ],
  });
}

// ---------- Pricing ----------
async function pricing(pane) {
  const types = await get('/spot-types');
  pane.innerHTML = `
    <div class="info">Each spot type has a price for monthly, quarterly and yearly billing. Assign types to spots under Buildings & spots.
      A rental can still have its own special rate.</div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" id="add">${icon.plus} Add spot type</button></div>
    <div class="card scroll-x">${types.length ? `<table class="data"><thead><tr><th>Type</th><th class="r">Monthly</th><th class="r">Quarterly</th><th class="r">Yearly</th></tr></thead>
      <tbody>${types.map((t) => `<tr class="click" data-id="${t.id}"><td><b>${esc(t.name)}</b><div class="muted small">${esc(t.description || '')}</div></td>
        <td class="r num">${money(t.monthly_cents)}</td><td class="r num">${money(t.quarterly_cents)}</td><td class="r num">${money(t.yearly_cents)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No spot types yet — e.g. “Indoor up to 24 ft”, “Covered outdoor”, “Open lot”.</div>'}</div>`;
  const reload = () => pricing(pane).catch(fail);
  pane.querySelector('#add').onclick = () => typeForm(null, reload);
  pane.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => typeForm(types.find((t) => t.id === Number(r.dataset.id)), reload));
}

function typeForm(t, reload) {
  const s = sheet({
    title: t ? 'Edit spot type' : 'Add spot type',
    body: `<form>${fields([
      { name: 'name', label: 'Name', placeholder: 'Indoor — up to 24 ft' },
      { name: 'description', label: 'Description' },
    ], t || {})}<div class="grid3">${fields([
      { name: 'monthly', label: 'Monthly ($)', type: 'money' },
      { name: 'quarterly', label: 'Quarterly ($)', type: 'money' },
      { name: 'yearly', label: 'Yearly ($)', type: 'money' },
    ], t ? { monthly: dollars(t.monthly_cents), quarterly: dollars(t.quarterly_cents), yearly: dollars(t.yearly_cents) } : {})}</div>
    <button type="button" class="btn sm" id="calc">Fill quarterly & yearly from monthly</button></form>`,
    buttons: [
      ...(t ? [{ label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete spot type?', 'Spots using it will have no type. Existing rentals keep their rate.', 'Delete', true))) return;
        await del(`/spot-types/${t.id}`); close(); reload();
      } }] : []),
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (t) await put(`/spot-types/${t.id}`, v); else await post('/spot-types', v);
        close(); toast('Saved'); reload();
      } },
    ],
  });
  const f = s.body.querySelector('form');
  s.body.querySelector('#calc').onclick = () => {
    const m = parseFloat(f.monthly.value.replace(/[$,]/g, ''));
    if (!m) return;
    f.quarterly.value = (m * 3).toFixed(2);
    f.yearly.value = (m * 12).toFixed(2);
  };
}

// ---------- Users ----------
async function users(pane) {
  const list = await get('/users');
  pane.innerHTML = `
    <div class="info"><b>Admin</b>: everything, including setup and users. <b>Owner</b>: customers, rentals, invoices and money stats.
      <b>Staff</b>: customers, notes, photos, spots and the incident log — no prices or invoices.</div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" id="add">${icon.plus} Add user</button></div>
    <div class="card"><ul class="list">${list.map((u) => `<li><div class="item" data-id="${u.id}" style="cursor:pointer">
      <div class="avatar">${esc(u.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
      <div class="main"><div class="title">${esc(u.name)}${u.id === state.session.user.id ? ' <span class="muted" style="font-weight:400">(you)</span>' : ''}</div>
        <div class="sub">${esc(u.email)} · ${u.last_login ? 'last in ' + when(u.last_login) : 'never signed in'}</div></div>
      <span class="badge ${u.role === 'admin' ? 'brand' : ''}">${roleName(u.role)}</span>${u.active ? '' : ' <span class="badge">Off</span>'}</div></li>`).join('')}</ul></div>`;
  const reload = () => users(pane).catch(fail);
  pane.querySelector('#add').onclick = () => userForm(null, reload);
  pane.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => userForm(list.find((u) => u.id === Number(r.dataset.id)), reload));
}

function userForm(u, reload) {
  const s = sheet({
    title: u ? 'Edit user' : 'Add user',
    body: `<form>${fields([
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email (used to sign in)', type: 'email', autocomplete: 'off' },
      { name: 'role', label: 'Role', type: 'select', options: [['user', 'Staff'], ['owner', 'Owner'], ['admin', 'Admin']] },
      { name: 'password', label: u ? 'New password (leave blank to keep)' : 'Temporary password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters. They can change it under My account.' },
      ...(u ? [{ name: 'active', label: 'Can sign in', type: 'checkbox' }] : []),
    ], u ? { ...u, active: Boolean(u.active) } : { role: 'user' })}</form>`,
    buttons: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (u) await put(`/users/${u.id}`, v); else await post('/users', v);
        close(); toast('Saved'); reload();
      } },
    ],
  });
}

// ---------- Import ----------
async function importPane(pane) {
  pane.innerHTML = `
    <div class="card pad">
      <h2 style="margin-bottom:6px">Import customers from Excel</h2>
      <p class="muted" style="margin-top:0">Upload an Excel (.xlsx) or CSV file with one customer per row. You’ll match your columns before anything is saved.
        Rows with an email already in the system are skipped. If the sheet has building/spot columns, those buildings and spots are created and the customer is assigned.</p>
      <div class="row">
        <label class="btn primary">${icon.upload} Choose file<input type="file" id="file" accept=".xlsx,.csv" hidden></label>
        <a class="btn" href="/api/import/template">${icon.download} Download template</a>
      </div>
    </div>
    <div id="map" style="margin-top:16px"></div>`;
  pane.querySelector('#file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try { showMapping(await api('POST', '/import/preview', fd)); } catch (err) { fail(err); }
    e.target.value = '';
  };

  function showMapping(p) {
    const el = pane.querySelector('#map');
    const opts = (sel) => `<option value="">— Skip —</option>${p.fields.map((f) => `<option value="${f.key}" ${f.key === sel ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}`;
    el.innerHTML = `<div class="card">
      <div class="card-head"><div><h3>${esc(p.fileName)}</h3><div class="muted small">${p.rowCount} row${p.rowCount === 1 ? '' : 's'} · match each column to a field</div></div></div>
      <div class="scroll-x"><table class="data map-table"><thead><tr><th>Your column</th><th>Goes into</th><th>Example</th></tr></thead><tbody>
        ${p.headers.map((h, i) => `<tr><td><b>${esc(h)}</b></td><td style="min-width:220px"><select data-i="${i}">${opts(p.mapping[i])}</select></td>
          <td class="muted small">${esc(p.sample.map((r) => r[i]).filter(Boolean).slice(0, 2).join(', '))}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card-body row" style="border-top:1px solid var(--line)"><div class="muted small" style="flex:1">Nothing is saved until you press Import.</div>
        <button class="btn primary" id="go">Import ${p.rowCount} row${p.rowCount === 1 ? '' : 's'}</button></div></div>`;
    el.querySelector('#go').onclick = async (e) => {
      const mapping = [...el.querySelectorAll('select[data-i]')].map((s) => s.value);
      const used = mapping.filter(Boolean);
      if (new Set(used).size !== used.length) return fail(new Error('Two columns are set to the same field.'));
      e.target.disabled = true;
      try {
        const r = await post('/import/commit', { token: p.token, mapping });
        el.innerHTML = `<div class="card pad"><h3 style="margin-bottom:8px">Import finished</h3>
          <p style="margin:0 0 8px">${r.created} customer${r.created === 1 ? '' : 's'} added · ${r.contracts} rental${r.contracts === 1 ? '' : 's'} set up
            ${r.buildingsCreated ? ` · ${r.buildingsCreated} building(s) created` : ''}${r.spotsCreated ? ` · ${r.spotsCreated} spot(s) created` : ''}</p>
          ${r.skipped.length ? `<p class="muted small" style="margin:0 0 6px">Needs a look:</p><ul class="small" style="margin:0;padding-left:18px">${r.skipped.map((s) => `<li>Row ${s.row}: ${esc(s.reason)}</li>`).join('')}</ul>` : ''}
          <div class="row" style="margin-top:14px"><a class="btn primary" href="#/customers">View customers</a>${r.spotsCreated ? '<a class="btn" href="#/setup/spots">Review spots</a>' : ''}</div></div>`;
      } catch (err) { e.target.disabled = false; fail(err); }
    };
  }
}

// ---------- Email & texts ----------
async function email(pane) {
  const s = await get('/settings');
  pane.innerHTML = `<div class="stack"><div class="card pad">
    <h2 style="margin-bottom:6px">Sending email</h2>
    <p class="muted" style="margin-top:0">Invoices, reminders and signing links are emailed through your email provider’s SMTP server. For Gmail or Google Workspace use
      <b>smtp.gmail.com</b>, port <b>465</b>, secure on, and an “app password”. For Outlook/Microsoft 365 use <b>smtp.office365.com</b>, port <b>587</b>.</p>
    <form class="grid2" id="fe">${fields([
      { name: 'smtpHost', label: 'SMTP server', placeholder: 'smtp.gmail.com' },
      { name: 'smtpPort', label: 'Port', type: 'number', placeholder: '587' },
      { name: 'smtpUser', label: 'Username', autocomplete: 'off' },
      { name: 'smtpPass', label: s.smtpPassSet ? 'Password (saved — leave blank to keep)' : 'Password', type: 'password', autocomplete: 'new-password' },
      { name: 'smtpFrom', label: 'From address', full: true, placeholder: '"McAlister Storage" <billing@example.com>' },
      { name: 'smtpSecure', label: 'Use secure connection (port 465)', type: 'checkbox' },
    ], s)}
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="test">${icon.send} Send test email</button></div>
    </form></div>

    <div class="card pad">
    <h2 style="margin-bottom:6px">Text messages (optional)</h2>
    <p class="muted" style="margin-top:0">Texts go through <b>Twilio</b> (about 1¢ per text plus a phone number). Create an account at twilio.com, buy a number,
      and paste the Account SID, Auth Token and number here. Texts only go to customers marked <b>“agreed to receive text messages”</b>.</p>
    <form class="grid2" id="fs">${fields([
      { name: 'smsEnabled', label: 'Turn on text messages', type: 'checkbox', full: true },
      { name: 'twilioSid', label: 'Account SID', autocomplete: 'off', placeholder: 'AC…' },
      { name: 'twilioToken', label: s.twilioTokenSet ? 'Auth Token (saved — leave blank to keep)' : 'Auth Token', type: 'password', autocomplete: 'new-password' },
      { name: 'twilioFrom', label: 'Twilio phone number', type: 'tel', placeholder: '+15735550123' },
      { name: 'testTo', label: 'Your mobile (for a test)', type: 'tel' },
    ], s)}
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="testSms">${icon.chat} Send test text</button></div>
    </form></div></div>`;
  const fe = pane.querySelector('#fe');
  fe.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(fe); v.smtpSecure = String(v.smtpSecure);
    try { await put('/settings', v); toast('Saved'); await refreshSession(); } catch (err) { fail(err); }
  };
  pane.querySelector('#test').onclick = async () => {
    try { await post('/settings/test-email', {}); toast(`Test email sent to ${state.session.user.email}`); } catch (err) { fail(err); }
  };
  const fs = pane.querySelector('#fs');
  fs.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(fs); delete v.testTo; v.smsEnabled = String(v.smsEnabled);
    try { await put('/settings', v); toast('Saved'); await refreshSession(); } catch (err) { fail(err); }
  };
  pane.querySelector('#testSms').onclick = async () => {
    try { await post('/settings/test-sms', { to: fs.testTo.value }); toast('Test text sent'); } catch (err) { fail(err); }
  };
}

// ---------- Agreement ----------
const MERGE = ['customer_name', 'company_name', 'spot', 'building', 'location', 'boat', 'registration', 'rate', 'billing_cycle', 'billing_period', 'start_date', 'end_date', 'today', 'customer_address', 'customer_phone', 'customer_email', 'company_phone'];

async function agreement(pane) {
  const s = await get('/settings');
  pane.innerHTML = `<div class="card pad">
    <h2 style="margin-bottom:6px">Rental agreement</h2>
    <p class="muted" style="margin-top:0">This is the text customers read and sign. Words in <code>{{double braces}}</code> fill in automatically from the customer and their rental.
      <b>The starter text is a general example — have your attorney review it before use.</b></p>
    <form>
      ${fields([{ name: 'agreementTitle', label: 'Title', value: s.agreementTitle }])}
      <label class="field"><span>Agreement text</span><textarea class="template" name="agreementTemplate">${esc(s.agreementTemplate)}</textarea></label>
      <div class="muted small" style="margin:-6px 0 6px">Tap to insert:</div>
      <div class="chips" id="chips">${MERGE.map((m) => `<button type="button" class="chip">{{${m}}}</button>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="pv">Preview with a real customer</button></div>
    </form></div>
    <p class="muted small">Changes apply to agreements sent from now on. Agreements already sent or signed keep the text the customer saw.</p>`;
  const f = pane.querySelector('form');
  const ta = f.agreementTemplate;
  pane.querySelector('#chips').onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const [a, z] = [ta.selectionStart, ta.selectionEnd];
    ta.setRangeText(b.textContent, a, z, 'end'); ta.focus();
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await put('/settings', { agreementTitle: f.agreementTitle.value, agreementTemplate: ta.value }); toast('Agreement saved'); } catch (err) { fail(err); }
  };
  pane.querySelector('#pv').onclick = async () => {
    try {
      const r = await get(`/agreements/preview?template=${encodeURIComponent(ta.value)}`);
      sheet({ title: f.agreementTitle.value || r.title, wide: true, body: `<p class="muted small" style="margin-top:0">Filled in with a current rental as an example.</p><div class="agreement-text">${esc(r.body)}</div>` });
    } catch (err) { fail(err); }
  };
}

// ---------- Reminders ----------
async function reminders(pane) {
  const s = await get('/settings');
  const feats = state.session.features;
  pane.innerHTML = `<div class="card pad">
    <h2 style="margin-bottom:6px">Automatic reminders</h2>
    <p class="muted" style="margin-top:0">Once a day, the app emails (and texts, if set up and the customer agreed) reminders that are due. Each reminder goes out once;
      past-due notices repeat on the schedule below. Customers can be excluded on their record.</p>
    ${!feats.email ? '<div class="info" style="background:var(--warn-soft)">Email isn’t set up yet, so reminders can’t be sent. Set it up under <a href="#/setup/email">Email & texts</a>.</div>' : ''}
    <form class="grid2">${fields([
      { name: 'remindersEnabled', label: 'Send reminders automatically every day', type: 'checkbox', full: true },
      { name: 'reminderHour', label: 'Send at', type: 'select', options: Array.from({ length: 14 }, (_, i) => [i + 7, `${((i + 7 - 1) % 12) + 1}:00 ${i + 7 < 12 ? 'AM' : 'PM'}`]) },
      { name: 'timezone', label: 'Time zone', type: 'select', options: [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']] },
      { name: 'reminderDueDays', label: 'Payment due: days before due date', type: 'number', hint: '0 turns this off' },
      { name: 'reminderOverdueDays', label: 'Past due: days after due date', type: 'number' },
      { name: 'reminderOverdueRepeatDays', label: 'Past due: repeat every (days)', type: 'number' },
      { name: 'reminderOverdueMax', label: 'Past due: most notices per invoice', type: 'number', hint: '0 turns this off. The last one says “final notice”.' },
      { name: 'reminderInsuranceDays', label: 'Insurance: days before it expires', type: 'number', hint: '0 turns this off' },
      { name: 'reminderEndingDays', label: 'Rental ending: days before end date', type: 'number', hint: '0 turns this off' },
    ], s)}
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button><a class="btn" href="#/invoices?reminders">${icon.bell} See what’s due now</a></div>
    </form></div>
    <div class="card pad" style="margin-top:16px">
    <h2 style="margin-bottom:6px">Late fees</h2>
    <p class="muted" style="margin-top:0">A late fee is added once to each invoice still unpaid after the grace period. It appears as a line on that invoice.
      You can waive it on any invoice. Check that your fee follows your storage agreement and state law.</p>
    <form class="grid2" id="lf">${fields([
      { name: 'lateFeeEnabled', label: 'Add late fees automatically every day', type: 'checkbox', full: true },
      { name: 'lateFeeType', label: 'Fee type', type: 'select', options: [['flat', 'Flat amount ($)'], ['percent', 'Percent of invoice (%)']] },
      { name: 'lateFeeAmount', label: 'Amount', type: 'money', hint: 'Dollars, or percent if “Percent” is picked' },
      { name: 'lateFeeGraceDays', label: 'Grace period (days after due date)', type: 'number' },
      { name: 'lateFeeMinimum', label: 'Minimum fee for percent ($)', type: 'money' },
    ], s)}
    <div style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button></div></form></div>`;
  const lf = pane.querySelector('#lf');
  lf.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(lf); v.lateFeeEnabled = String(v.lateFeeEnabled);
    try { await put('/settings', v); toast('Late fee settings saved'); await refreshSession(); } catch (err) { fail(err); }
  };
  const f = pane.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f); v.remindersEnabled = String(v.remindersEnabled);
    try { await put('/settings', v); toast('Saved'); await refreshSession(); } catch (err) { fail(err); }
  };
}

// ---------- Payments & portal ----------
async function payments(pane) {
  const s = await get('/settings');
  const hook = `${location.origin}/api/public/stripe/webhook`;
  pane.innerHTML = `<div class="stack">
    <div class="card pad">
      <div class="spread"><h2>Online card payments (Stripe)</h2>${state.session.features.stripe ? '<span class="badge good">On</span>' : '<span class="badge">Off</span>'}</div>
      <p class="muted">Optional. When on, emailed invoices and reminders include a <b>Pay online</b> link, customers can pay in their online account,
        and paid invoices are marked paid automatically. Stripe charges its standard card fee (about 2.9% + 30¢); card numbers go to Stripe, never this app.</p>
      <ol class="small" style="padding-left:18px;color:var(--ink-2);margin:0 0 14px">
        <li>Create a free account at <b>stripe.com</b> and finish its business setup.</li>
        <li>In Stripe: <b>Developers → API keys</b>. Copy the <b>Secret key</b> (starts with <code>sk_live_</code>; use <code>sk_test_</code> to try it first).</li>
        <li>Optional but recommended: <b>Developers → Webhooks → Add endpoint</b> with the address below, event <code>checkout.session.completed</code>. Copy its <b>Signing secret</b>.</li>
      </ol>
      <form class="grid2">${fields([
        { name: 'stripeEnabled', label: 'Turn on online payments', type: 'checkbox', full: true },
        { name: 'stripeSecretKey', label: s.stripeSecretKeySet ? 'Secret key (saved — leave blank to keep)' : 'Secret key', type: 'password', autocomplete: 'off', full: true, placeholder: 'sk_live_…' },
        { name: 'stripeWebhookSecret', label: s.stripeWebhookSecretSet ? 'Webhook signing secret (saved)' : 'Webhook signing secret (optional)', type: 'password', autocomplete: 'off', full: true, placeholder: 'whsec_…' },
      ], s)}
      <label class="field" style="grid-column:1/-1"><span>Webhook address for Stripe</span><input readonly value="${esc(hook)}" onclick="this.select()"></label>
      <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="testStripe">Check key</button></div>
      </form>
    </div>

    <div class="card pad">
      <div class="spread"><h2>Customer online accounts</h2>${s.portalEnabled === 'true' ? '<span class="badge good">On</span>' : '<span class="badge">Off</span>'}</div>
      <p class="muted">Customers sign in with an emailed link (no password) at <b>${esc(location.origin)}/portal</b> to see their storage, invoices and signed agreements,
        update their contact info, and pay online if Stripe is on. Send someone their link from their customer page (<b>Account link</b>).</p>
      <form id="pf">${fields([{ name: 'portalEnabled', label: 'Let customers use online accounts', type: 'checkbox' }], s)}
        <button class="btn primary" type="submit">Save</button></form>
    </div></div>`;
  const f = pane.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f); v.stripeEnabled = String(v.stripeEnabled);
    try { await put('/settings', v); toast('Saved'); await refreshSession(); payments(pane); } catch (err) { fail(err); }
  };
  pane.querySelector('#testStripe').onclick = async () => {
    try { const r = await post('/settings/test-stripe'); toast(`Connected to Stripe: ${r.account}${r.live ? '' : ' (test mode)'}`); } catch (err) { fail(err); }
  };
  const pf = pane.querySelector('#pf');
  pf.onsubmit = async (e) => {
    e.preventDefault();
    try { await put('/settings', { portalEnabled: String(pf.portalEnabled.checked) }); toast('Saved'); await refreshSession(); payments(pane); } catch (err) { fail(err); }
  };
}
