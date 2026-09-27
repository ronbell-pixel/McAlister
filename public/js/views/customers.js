import { get, post, put, del, esc, money, dollars, date, when, icon, toast, fail, sheet, confirmSheet, fields, formData, fullName, initials, today, statusBadge } from '../ui.js';
import { main, can, state, clearQuery, withLoc } from '../app.js';
import { notesPanel, photosPanel } from '../widgets.js';

const STATUS = [['active', 'Active'], ['prospect', 'Prospect'], ['inactive', 'Inactive']];
const statusBadgeC = (s) => ({ active: '<span class="badge good">Active</span>', prospect: '<span class="badge brand">Prospect</span>', inactive: '<span class="badge">Inactive</span>' }[s] || '');

// ---------------- List ----------------
export async function customerList() {
  const q = state.query;
  let filter = sessionStorageGet('custFilter') || 'active';
  let search = '';
  main().innerHTML = `
    <div class="page-head"><h1>Customers</h1><div class="actions"><button class="btn primary" id="new">${icon.plus} New customer</button></div></div>
    <div class="row" style="margin-bottom:12px">
      <div class="search">${icon.search}<input type="search" id="q" placeholder="Search name, phone, boat, spot…" aria-label="Search customers"></div>
      <div class="segmented" id="seg">${[['active', 'Active'], ['prospect', 'Prospects'], ['inactive', 'Inactive'], ['', 'All']].map(([v, l]) =>
        `<button data-v="${v}" class="${v === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;

  const listEl = document.getElementById('list');
  async function load() {
    const rows = await get(withLoc(`/customers?status=${filter}&q=${encodeURIComponent(search)}`));
    if (!rows.length) { listEl.innerHTML = `<div class="empty">${search ? 'No matches.' : 'No customers here yet.'}</div>`; return; }
    listEl.innerHTML = `<ul class="list">${rows.map((c) => `<li><a class="item" href="#/customers/${c.id}">
      <div class="avatar">${esc(initials(c))}</div>
      <div class="main"><div class="title">${esc(fullName(c))}${c.company && (c.first_name || c.last_name) ? ` <span class="muted" style="font-weight:400">· ${esc(c.company)}</span>` : ''}</div>
        <div class="sub">${esc([c.phone, c.spots ? 'Spot ' + c.spots : ''].filter(Boolean).join(' · ') || c.email || '')}</div></div>
      <div class="end">${c.balance_cents ? `<div class="num small" style="color:var(--warn);font-weight:650">${money(c.balance_cents)} due</div>` : ''}${filter === '' ? statusBadgeC(c.status) : ''}</div>
      ${icon.chevron.replace('<svg', '<svg class="chev"')}</a></li>`).join('')}</ul>`;
  }
  let t;
  document.getElementById('q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim(); load().catch(fail); }, 200); };
  document.getElementById('seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.v; sessionStorageSet('custFilter', filter);
    document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(fail);
  };
  document.getElementById('new').onclick = () => customerForm();
  await load();
  if (q.has('new')) { clearQuery(); customerForm(); }
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

const CUSTOMER_FIELDS = [
  { name: 'first_name', label: 'First name', autocomplete: 'off' },
  { name: 'last_name', label: 'Last name', autocomplete: 'off' },
  { name: 'company', label: 'Company (optional)', full: true },
  { name: 'phone', label: 'Mobile phone', type: 'tel' },
  { name: 'alt_phone', label: 'Other phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email', full: true },
  { name: 'address', label: 'Street address', full: true },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'zip', label: 'ZIP', type: 'text' },
  { name: 'status', label: 'Status', type: 'select', options: STATUS },
  { name: 'emergency_name', label: 'Emergency contact' },
  { name: 'emergency_phone', label: 'Emergency phone', type: 'tel' },
  { html: '<div style="grid-column:1/-1;margin-top:4px"><span class="muted small" style="font-weight:600">Messages</span></div>' },
  { name: 'reminders_ok', label: 'Send automatic reminders (payment, insurance, renewal)', type: 'checkbox', full: true },
  { name: 'sms_ok', label: 'Customer agreed to receive text messages', type: 'checkbox', full: true },
];

export function customerForm(c = null, onSaved) {
  const s = sheet({
    title: c ? 'Edit customer' : 'New customer',
    body: `<form class="grid2">${fields(CUSTOMER_FIELDS, c ? { ...c, sms_ok: Boolean(c.sms_ok), reminders_ok: c.reminders_ok !== 0 } : { status: 'active', reminders_ok: true })}</form>`,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: c ? 'Save' : 'Add customer', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (c) { await put(`/customers/${c.id}`, v); toast('Saved'); close(); onSaved && onSaved(); }
        else { const { id } = await post('/customers', v); close(); toast('Customer added'); location.hash = `#/customers/${id}`; }
      } },
    ],
  });
  s.body.querySelector('form').onsubmit = (e) => e.preventDefault();
}

// ---------------- Detail ----------------
export async function customerDetail(id) {
  const d = await get(`/customers/${id}`);
  const c = d.customer;
  const addr = [c.address, [c.city, c.state].filter(Boolean).join(', ') + (c.zip ? ' ' + c.zip : '')].filter((x) => x && x.trim()).join('<br>');
  const active = d.contracts.filter((k) => k.status === 'active');
  const balance = (d.invoices || []).filter((i) => i.status === 'sent').reduce((a, i) => a + i.total_cents, 0);

  main().innerHTML = `
    <a class="back" href="#/customers">${icon.back} Customers</a>
    <div class="card pad" style="margin-bottom:16px">
      <div class="profile">
        <div class="avatar">${esc(initials(c))}</div>
        <div style="flex:1;min-width:0">
          <h1 style="font-size:22px">${esc(fullName(c))}</h1>
          <div class="row small muted" style="gap:8px;margin-top:4px">${statusBadgeC(c.status)}
            ${active.length ? `<span>Spot ${active.map((k) => esc(k.spot_label || '—')).join(', ')}</span>` : ''}
            ${can('invoices') && balance ? `<span class="badge warn">${money(balance)} open</span>` : ''}</div>
        </div>
        <div class="actions row" style="gap:8px">
          <button class="btn sm" id="edit">${icon.edit}<span>Edit</span></button>
        </div>
      </div>
      <div class="contact-actions">
        ${c.phone ? `<a class="btn" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icon.phone}Call</a><a class="btn" href="sms:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icon.chat}Text</a>` : ''}
        ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon.mail}Email</a>` : ''}
      </div>
    </div>

    <div class="detail-grid">
      <div class="stack" id="colA">
        <div class="card"><div class="card-head"><h3>Contact</h3></div><div class="card-body">
          <dl class="kv">
            ${c.company && (c.first_name || c.last_name) ? `<dt>Company</dt><dd>${esc(c.company)}</dd>` : ''}
            <dt>Phone</dt><dd>${c.phone ? esc(c.phone) : '<span class="muted">—</span>'}${c.alt_phone ? `<br><span class="muted small">Other:</span> ${esc(c.alt_phone)}` : ''}</dd>
            <dt>Email</dt><dd>${c.email ? esc(c.email) : '<span class="muted">—</span>'}</dd>
            <dt>Address</dt><dd>${addr ? addr.split('<br>').map(esc).join('<br>') : '<span class="muted">—</span>'}</dd>
            <dt>Emergency</dt><dd>${c.emergency_name || c.emergency_phone ? esc([c.emergency_name, c.emergency_phone].filter(Boolean).join(' · ')) : '<span class="muted">—</span>'}</dd>
            <dt>Customer since</dt><dd>${date(c.created_at)}</dd>
          </dl></div></div>

        <div class="card" id="rentals"></div>
        <div class="card" id="boats"></div>
        ${d.invoices ? '<div class="card" id="invoices"></div>' : ''}
      </div>
      <div class="stack" id="colB"></div>
    </div>
    ${can('customers.delete') ? `<div style="margin-top:24px;text-align:center"><button class="btn ghost danger" id="delete">${icon.trash} Delete customer</button></div>` : ''}`;

  const reload = () => customerDetail(id).catch(fail);
  document.getElementById('edit').onclick = () => customerForm(c, reload);
  const delBtn = document.getElementById('delete');
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmSheet('Delete customer?', `This permanently removes ${fullName(c)} with their boats, notes, photos and invoices. To keep history, mark them Inactive instead.`, 'Delete', true))) return;
    try { await del(`/customers/${id}`); toast('Customer deleted'); location.hash = '#/customers'; } catch (e) { fail(e); }
  };

  renderRentals(d, reload);
  renderBoats(d, reload);
  if (d.invoices) renderInvoices(d);

  const colB = document.getElementById('colB');
  notesPanel(colB, 'customer', id, d.notes);
  photosPanel(colB, 'customer', id, d.attachments, 'Photos & documents');
  if (d.incidents.length) {
    colB.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-head"><h3>Incidents</h3></div><ul class="list">
      ${d.incidents.map((i) => `<li><a class="item" href="#/log/${i.id}"><div class="main"><div class="title">${esc(i.title)}</div><div class="sub">${date(i.occurred_on)}</div></div>
      <span class="badge ${i.status === 'open' ? 'warn' : 'good'}">${i.status}</span></a></li>`).join('')}</ul></div>`);
  }
  colB.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-head"><h3>History</h3></div><ul class="list">
    ${d.activity.length ? d.activity.slice(0, 10).map((a) => `<li><div class="item"><div class="main"><div class="title" style="font-weight:500;white-space:normal">${esc(a.message)}</div>
      <div class="sub">${esc(a.user_name || '')}${a.user_name ? ' · ' : ''}${when(a.created_at)}</div></div></div></li>`).join('') : '<li class="empty">No history yet.</li>'}</ul></div>`);
}

const CYCLE = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

function renderRentals(d, reload) {
  const el = document.getElementById('rentals');
  const canEdit = can('contracts.edit');
  const agFor = (k) => (d.agreements || []).find((a) => a.contract_id === k.id);
  const agLine = (k) => {
    if (k.status !== 'active') return '';
    const a = agFor(k);
    const badge = !a ? '<span class="badge">Agreement not sent</span>'
      : a.status === 'signed' ? `<span class="badge good">${icon.check.replace('<svg', '<svg width="12" height="12"')} Signed ${date(a.signed_at)}</span>`
      : `<span class="badge warn">Sent ${date(a.sent_at)}${a.viewed_at ? ' · opened' : ''}</span>`;
    return `<div class="sub-actions">${badge}${canEdit || (a && a.status === 'signed') ? `<button class="btn sm" data-ag="${k.id}" style="min-height:28px;padding:0 10px">${icon.pen} ${a && a.status === 'signed' ? 'View' : a ? 'Manage' : 'Send for signature'}</button>` : ''}</div>`;
  };
  el.innerHTML = `<div class="card-head"><h3>Storage rentals</h3>${canEdit ? `<button class="btn sm" id="addRental">${icon.plus} Assign spot</button>` : ''}</div>
    ${d.waitlist && d.waitlist.length ? `<div class="card-body" style="padding:10px 16px;border-bottom:1px solid var(--line)"><span class="badge warn">${icon.clock.replace('<svg', '<svg width="12" height="12"')} On the waitlist since ${date(d.waitlist[0].created_at)}</span></div>` : ''}
    <ul class="list">${d.contracts.length ? d.contracts.map((k) => `<li><div class="item" style="align-items:flex-start"><div class="main" ${canEdit ? `data-k="${k.id}" style="cursor:pointer"` : ''}>
      <div class="title">${k.spot_label ? `${esc(k.building)} · Spot ${esc(k.spot_label)}` : 'No spot assigned'}</div>
      <div class="sub">${CYCLE[k.billing_cycle]}${k.rate_cents != null ? ' · ' + money(k.rate_cents) : ''}${k.boat_name || k.boat_make ? ' · ' + esc(k.boat_name || k.boat_make) : ''}
        ${k.status === 'active' ? ` · next bill ${date(k.next_bill_date)}` : ` · ended ${date(k.end_date)}`}</div></div>
      ${k.status === 'active' ? '<span class="badge good">Active</span>' : '<span class="badge">Ended</span>'}</div>
      <div style="padding:0 16px 12px;margin-top:-6px">${agLine(k)}</div></li>`).join('')
      : '<li class="empty">No spot assigned.</li>'}</ul>`;
  el.querySelectorAll('[data-ag]').forEach((b) => b.onclick = () => {
    const k = d.contracts.find((x) => x.id === Number(b.dataset.ag));
    agreementSheet(d, k, agFor(k), reload).catch(fail);
  });
  if (!canEdit) return;
  document.getElementById('addRental').onclick = () => rentalForm(d, null, reload);
  el.querySelectorAll('[data-k]').forEach((row) => row.onclick = () => rentalForm(d, d.contracts.find((k) => k.id === Number(row.dataset.k)), reload));
}

// ---------- E-signature ----------
async function agreementSheet(d, k, a, reload) {
  const c = d.customer;
  const feats = state.session.features;
  if (a && a.status === 'signed') {
    const s = sheet({
      title: 'Signed agreement',
      body: `<dl class="kv"><dt>Signed by</dt><dd>${esc(a.signer_name)}</dd><dt>Signed</dt><dd>${when(a.signed_at)} (${date(a.signed_at)})</dd>
        <dt>Sent</dt><dd>${date(a.sent_at)}${a.sent_via ? ` by ${a.sent_via === 'sms' ? 'text' : a.sent_via}` : ' (signed in person)'}</dd></dl>
        <p class="muted small">The signed PDF, with the signature record, is saved under Photos & documents.</p>`,
      buttons: [
        ...(can('contracts.edit') ? [{ label: 'Send a new one', onClick: async (close) => { close(); agreementSheet(d, k, null, reload); } }] : []),
        { label: `${icon.download} Open signed PDF`, kind: 'primary', onClick: (close) => { window.open(`/api/attachments/${a.attachment_id}/file`, '_blank'); close(); } },
      ],
    });
    return s;
  }
  const pv = await get(`/agreements/preview?contract_id=${k.id}`);
  const canEmail = Boolean(c.email) && feats.email;
  const canText = Boolean(c.phone) && feats.sms;
  const s = sheet({
    title: a ? 'Agreement waiting for signature' : 'Send agreement for signature',
    wide: true,
    body: `${a ? `<div class="info">Sent ${date(a.sent_at)}${a.sent_via ? ` by ${a.sent_via === 'sms' ? 'text' : 'email'}` : ''}. ${a.viewed_at ? `Opened ${when(a.viewed_at)}.` : 'Not opened yet.'} Links last 30 days; sending again renews it.</div>`
        : `<p class="muted small" style="margin-top:0">${esc(fullName(c))} gets a secure link to read and sign on their phone or computer. Or hand them your iPad and use <b>Sign here now</b>. The text comes from Setup → Agreement.</p>`}
      <h3 style="margin:4px 0 8px">${esc(pv.title)}</h3>
      <div class="agreement-text">${esc(a ? '' : pv.body) || '<span class="muted">Same text as when it was sent.</span>'}</div>
      ${!canEmail || !canText ? `<p class="muted small">${[!c.email ? 'No email on file.' : !feats.email ? 'Email isn’t set up.' : '', !c.phone ? 'No phone on file.' : !feats.sms ? 'Texting isn’t set up.' : ''].filter(Boolean).join(' ')}</p>` : ''}`,
    buttons: [
      ...(a ? [{ label: 'Cancel it', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Cancel this agreement?', 'The signing link will stop working.', 'Cancel agreement', true))) return;
        await post(`/agreements/${a.id}/void`); close(); reload();
      } }] : []),
      { label: `${icon.pen} Sign here now`, onClick: async (close, btn) => {
        const url = a ? (await get(`/agreements/${a.id}/link`)).url : (await post(`/contracts/${k.id}/agreement`, { via: 'none' })).url;
        close(); reload();
        signHereNow(url);
      } },
      ...(canText ? [{ label: `${icon.chat} Text link`, onClick: async (close) => {
        if (a) await post(`/agreements/${a.id}/send`, { via: 'sms' }); else await post(`/contracts/${k.id}/agreement`, { via: 'sms' });
        close(); toast('Signing link texted'); reload();
      } }] : []),
      ...(canEmail ? [{ label: `${icon.mail} Email link`, kind: 'primary', onClick: async (close) => {
        if (a) await post(`/agreements/${a.id}/send`, { via: 'email' }); else await post(`/contracts/${k.id}/agreement`, { via: 'email' });
        close(); toast('Signing link emailed'); reload();
      } }] : []),
    ],
  });
  return s;
}

// Opening a new tab after a network call gets blocked on iPhone, so show a tap-to-open button.
function signHereNow(url) {
  sheet({
    title: 'Ready to sign',
    body: `<p style="margin-top:0">Open the signing page and hand the device to the customer. When they finish, come back to this tab.</p>
      <a class="btn primary block" href="${esc(url)}" target="_blank" rel="noopener">${icon.pen} Open signing page</a>
      <p class="muted small" style="margin-bottom:0;overflow-wrap:anywhere">Link: ${esc(url)}</p>`,
  });
}

async function rentalForm(d, k, reload) {
  const spots = await get('/spots');
  const avail = spots.filter((s) => s.active && (!s.contract_id || (k && s.id === k.spot_id)));
  const byBuilding = {};
  for (const s of avail) (byBuilding[s.building] ||= []).push(s);
  const spotOptions = `<option value="">— Choose a spot —</option>` + Object.entries(byBuilding).map(([b, list]) =>
    `<optgroup label="${esc(b)}">${list.map((s) => `<option value="${s.id}" ${k && k.spot_id === s.id ? 'selected' : ''}>${esc(s.label)}${s.type_name ? ' — ' + esc(s.type_name) : ''}</option>`).join('')}</optgroup>`).join('');
  const v = k ? { ...k, rate: dollars(k.rate_cents) } : { billing_cycle: 'monthly', start_date: today(), next_bill_date: today() };

  const s = sheet({
    title: k ? 'Edit rental' : 'Assign a spot',
    body: `<form class="grid2">
      <label class="field" style="grid-column:1/-1"><span>Spot</span><select name="spot_id">${spotOptions}</select>
        ${!avail.length ? '<small>No open spots. Add more under Setup → Buildings & spots.</small>' : ''}</label>
      ${fields([
        { name: 'boat_id', label: 'Boat', type: 'select', options: [['', '—'], ...d.boats.map((b) => [b.id, [b.name, b.make, b.model].filter(Boolean).join(' ') || 'Boat'])] },
        { name: 'billing_cycle', label: 'Billing', type: 'select', options: Object.entries(CYCLE) },
        { name: 'rate', label: 'Rate per cycle ($)', type: 'money', hint: 'Fills in from the spot’s price — change it for a special rate' },
        { name: 'start_date', label: 'Start date', type: 'date' },
        { name: 'next_bill_date', label: 'Next bill date', type: 'date', hint: 'First day of the next period to invoice' },
        { name: 'end_date', label: 'End date (optional)', type: 'date' },
        { name: 'notes', label: 'Rental notes', type: 'textarea', full: true, rows: 2 },
      ], v)}</form>`,
    buttons: [
      ...(k && k.status === 'active' ? [{ label: 'End rental', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('End this rental?', 'The spot becomes available and billing stops.', 'End rental', true))) return;
        await post(`/contracts/${k.id}/end`, { end_date: today() }); close(); toast('Rental ended'); reload();
      } }] : []),
      { label: 'Cancel', onClick: (close) => close() },
      ...(!k || k.status === 'active' ? [{ label: k ? 'Save' : 'Assign', kind: 'primary', onClick: async (close) => {
        const body = formData(s.body);
        if (!body.spot_id && !(await confirmSheet('No spot selected', 'Save this rental without a spot?', 'Save'))) return;
        if (k) await put(`/contracts/${k.id}`, body); else await post(`/customers/${d.customer.id}/contracts`, body);
        close(); toast('Saved'); reload();
      } }] : []),
    ],
  });
  const f = s.body.querySelector('form');
  f.onsubmit = (e) => e.preventDefault();
  // Auto-fill the rate from pricing when the spot or cycle changes.
  const fill = async () => {
    if (!f.spot_id.value) return;
    const { rate_cents } = await get(`/rate-for?spot_id=${f.spot_id.value}&cycle=${f.billing_cycle.value}`);
    if (rate_cents) f.rate.value = dollars(rate_cents);
  };
  f.spot_id.onchange = fill; f.billing_cycle.onchange = fill;
  f.start_date.onchange = () => { if (!k) f.next_bill_date.value = f.start_date.value; };
  if (!k) fill();
}

function renderBoats(d, reload) {
  const el = document.getElementById('boats');
  const canEdit = can('customers.edit');
  el.innerHTML = `<div class="card-head"><h3>Boats</h3>${canEdit ? `<button class="btn sm" id="addBoat">${icon.plus} Add boat</button>` : ''}</div>
    <ul class="list">${d.boats.length ? d.boats.map((b) => {
      const exp = b.insurance_expires;
      const expBadge = exp ? (exp < today() ? `<span class="badge bad">Ins. expired</span>` : '') : '';
      return `<li><div class="item" ${canEdit ? `data-b="${b.id}" style="cursor:pointer"` : ''}><div class="main">
        <div class="title">${esc(b.name || [b.make, b.model].filter(Boolean).join(' ') || 'Boat')}</div>
        <div class="sub">${esc([b.name ? [b.make, b.model].filter(Boolean).join(' ') : '', b.year, b.length_ft ? b.length_ft + ' ft' : '', b.registration].filter(Boolean).join(' · '))}</div>
        ${b.insurance_carrier || exp ? `<div class="sub">Insurance: ${esc([b.insurance_carrier, b.insurance_policy].filter(Boolean).join(' #'))}${exp ? ' · exp ' + date(exp) : ''}</div>` : ''}
      </div>${expBadge}</div></li>`;
    }).join('') : '<li class="empty">No boats on file.</li>'}</ul>`;
  if (!canEdit) return;
  document.getElementById('addBoat').onclick = () => boatForm(d.customer.id, null, reload);
  el.querySelectorAll('[data-b]').forEach((row) => row.onclick = () => boatForm(d.customer.id, d.boats.find((b) => b.id === Number(row.dataset.b)), reload));
}

function boatForm(customerId, b, reload) {
  const s = sheet({
    title: b ? 'Edit boat' : 'Add boat',
    body: `<form class="grid2">${fields([
      { name: 'name', label: 'Boat name' },
      { name: 'registration', label: 'Registration / HIN' },
      { name: 'make', label: 'Make' },
      { name: 'model', label: 'Model' },
      { name: 'year', label: 'Year', type: 'number' },
      { name: 'length_ft', label: 'Length (ft)', type: 'number' },
      { name: 'insurance_carrier', label: 'Insurance company' },
      { name: 'insurance_policy', label: 'Policy #' },
      { name: 'insurance_expires', label: 'Insurance expires', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
    ], b || {})}</form>`,
    buttons: [
      ...(b ? [{ label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete boat?', 'Remove this boat from the customer?', 'Delete', true))) return;
        await del(`/boats/${b.id}`); close(); reload();
      } }] : []),
      { label: 'Cancel', onClick: (close) => close() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (b) await put(`/boats/${b.id}`, v); else await post(`/customers/${customerId}/boats`, v);
        close(); toast('Saved'); reload();
      } },
    ],
  });
}

function renderInvoices(d) {
  const el = document.getElementById('invoices');
  el.innerHTML = `<div class="card-head"><h3>Invoices</h3><a class="btn sm" href="#/invoices?new=${d.customer.id}">${icon.plus} New</a></div>
    <ul class="list">${d.invoices.length ? d.invoices.slice(0, 12).map((i) => `<li><a class="item" href="#/invoices?open=${i.id}">
      <div class="main"><div class="title">${esc(i.number)}</div><div class="sub">${date(i.issue_date)} · due ${date(i.due_date)}</div></div>
      <div class="end"><div class="num" style="font-weight:600">${money(i.total_cents)}</div>${statusBadge(i)}</div></a></li>`).join('')
      : '<li class="empty">No invoices yet.</li>'}
      ${d.invoices.length > 12 ? `<li><a class="item" href="#/invoices?customer=${d.customer.id}"><div class="main muted">All ${d.invoices.length} invoices</div></a></li>` : ''}</ul>`;
}
