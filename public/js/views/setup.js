import { get, post, put, del, api, esc, money, dollars, date, when, icon, toast, fail, sheet, confirmSheet, fields, formData } from '../ui.js';
import { main, state, roleName } from '../app.js';

const TABS = [
  ['company', 'Company'], ['spots', 'Buildings & spots'], ['pricing', 'Pricing'],
  ['users', 'Users'], ['import', 'Import'], ['email', 'Email'], ['payments', 'Online payments'],
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
  await ({ company, spots, pricing, users, import: importPane, email, payments })[tab](pane);
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
  const [buildings, spotList, types] = await Promise.all([get('/buildings'), get('/spots'), get('/spot-types')]);
  const typeOpts = [['', '— No type —'], ...types.map((t) => [t.id, t.name])];
  pane.innerHTML = `
    <div class="info">Set up each building or lot, then add the numbered spots inside it. Spot <b>types</b> (under Pricing) set the default price.</div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" id="addB">${icon.plus} Add building</button>
      ${buildings.length ? `<button class="btn" id="addS">${icon.plus} Add spots</button>` : ''}</div>
    <div class="stack">${buildings.length ? buildings.map((b) => {
      const list = spotList.filter((s) => s.building_id === b.id);
      return `<div class="card"><div class="card-head"><div><h3>${esc(b.name)}</h3><div class="muted small">${esc(b.location || '')}${b.location ? ' · ' : ''}${list.length} spot${list.length === 1 ? '' : 's'}</div></div>
        <button class="btn sm" data-eb="${b.id}">${icon.edit} Edit</button></div>
        ${list.length ? `<div class="scroll-x"><table class="data"><thead><tr><th>Spot</th><th>Type</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>
          ${list.map((s) => `<tr class="click" data-es="${s.id}"><td><b>${esc(s.label)}</b></td><td>${esc(s.type_name || '—')}</td>
            <td class="muted">${[s.length_ft && s.length_ft + "'", s.width_ft && s.width_ft + "'"].filter(Boolean).join(' × ')}</td>
            <td>${s.contract_id ? `<span class="badge brand">${esc(s.customer_name)}</span>` : s.active ? '<span class="badge good">Vacant</span>' : '<span class="badge">Not in use</span>'}</td>
            <td class="r">${icon.edit.replace('<svg', '<svg width="16" height="16" style="color:var(--ink-3)"')}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">No spots yet.</div>'}</div>`;
    }).join('') : '<div class="card empty">No buildings yet. Add your first building or lot.</div>'}</div>`;

  const reload = () => spots(pane).catch(fail);
  pane.querySelector('#addB').onclick = () => buildingForm(null, reload);
  pane.querySelectorAll('[data-eb]').forEach((b) => b.onclick = () => buildingForm(buildings.find((x) => x.id === Number(b.dataset.eb)), reload));
  const addS = pane.querySelector('#addS');
  if (addS) addS.onclick = () => addSpotsForm(buildings, typeOpts, reload);
  pane.querySelectorAll('[data-es]').forEach((r) => r.onclick = () => editSpotForm(spotList.find((s) => s.id === Number(r.dataset.es)), buildings, typeOpts, reload));
}

function buildingForm(b, reload) {
  const s = sheet({
    title: b ? 'Edit building' : 'Add building',
    body: `<form>${fields([
      { name: 'name', label: 'Name', placeholder: 'Building A, North Lot…' },
      { name: 'location', label: 'Location / description' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ], b || {})}</form>`,
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

// ---------- Email ----------
async function email(pane) {
  const s = await get('/settings');
  pane.innerHTML = `<div class="card pad">
    <h2 style="margin-bottom:6px">Sending email</h2>
    <p class="muted" style="margin-top:0">Invoices are emailed through your email provider’s SMTP server. For Gmail or Google Workspace use
      <b>smtp.gmail.com</b>, port <b>465</b>, secure on, and an “app password”. For Outlook/Microsoft 365 use <b>smtp.office365.com</b>, port <b>587</b>.</p>
    <form class="grid2">${fields([
      { name: 'smtpHost', label: 'SMTP server', placeholder: 'smtp.gmail.com' },
      { name: 'smtpPort', label: 'Port', type: 'number', placeholder: '587' },
      { name: 'smtpUser', label: 'Username', autocomplete: 'off' },
      { name: 'smtpPass', label: s.smtpPassSet ? 'Password (saved — leave blank to keep)' : 'Password', type: 'password', autocomplete: 'new-password' },
      { name: 'smtpFrom', label: 'From address', full: true, placeholder: '"McAlister Storage" <billing@example.com>' },
      { name: 'smtpSecure', label: 'Use secure connection (port 465)', type: 'checkbox' },
    ], s)}
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="test">${icon.send} Send test email</button></div>
    </form></div>`;
  const f = pane.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f); v.smtpSecure = String(v.smtpSecure);
    try { await put('/settings', v); toast('Saved'); state.session = await get('/session'); } catch (err) { fail(err); }
  };
  pane.querySelector('#test').onclick = async () => {
    try { await post('/settings/test-email', {}); toast(`Test email sent to ${state.session.user.email}`); } catch (err) { fail(err); }
  };
}

// ---------- Payments ----------
async function payments(pane) {
  pane.innerHTML = `<div class="card pad">
    <div class="spread"><h2>Online payments (Stripe)</h2><span class="badge">Not connected</span></div>
    <p class="muted">Optional. When switched on, each emailed invoice will include a secure “Pay online” link and paid invoices will be marked automatically.
      This is planned for a later phase and can be added any time without changing how you work today.</p>
    <p class="muted" style="margin-bottom:0">Until then, record check, cash, card-in-person and bank payments with <b>Record payment</b> on any invoice.</p>
  </div>`;
}
