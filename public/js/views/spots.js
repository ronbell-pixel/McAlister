import { get, post, esc, money, dollars, icon, toast, fail, sheet, fields, formData, fullName, today } from '../ui.js';
import { main, can, withLoc, multiLocation } from '../app.js';
import { matchesFor } from './waitlist.js';
import { notesPanel, photosPanel } from '../widgets.js';

const CYCLE = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export async function spotsBoard() {
  let show = 'all';
  let spots = await get(withLoc('/spots'));
  let types = await get('/spot-types');

  main().innerHTML = `
    <div class="page-head"><h1>Spots</h1><div class="actions">${can('setup') ? `<a class="btn" href="#/setup/spots">${icon.gear} Manage spots</a>` : ''}</div></div>
    <div class="row" style="margin-bottom:14px;justify-content:space-between">
      <div class="segmented" id="seg">${[['all', 'All'], ['vacant', 'Vacant'], ['rented', 'Rented']].map(([v, l]) => `<button data-v="${v}" class="${v === show ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="legend"><span><i></i>Vacant</span><span><i class="r"></i>Rented</span></div>
    </div>
    <div id="board" class="stack"></div>`;

  const board = document.getElementById('board');
  function render() {
    if (!spots.length) {
      board.innerHTML = `<div class="card empty">No spots set up yet.${can('setup') ? ' <a href="#/setup/spots">Add buildings and spots</a>.' : ''}</div>`;
      return;
    }
    const groups = {};
    for (const s of spots) (groups[multiLocation() && s.location_name ? `${s.location_name} · ${s.building}` : s.building] ||= []).push(s);
    board.innerHTML = Object.entries(groups).map(([b, list]) => {
      const rented = list.filter((s) => s.contract_id).length;
      const shown = list.filter((s) => show === 'all' || (show === 'vacant' ? !s.contract_id && s.active : s.contract_id));
      return `<div class="card"><div class="card-head"><h3>${esc(b)}</h3><span class="muted small num">${rented} / ${list.filter((s) => s.active).length} rented</span></div>
        <div class="card-body">${shown.length ? `<div class="spot-grid">${shown.map((s) => `<button class="spot ${s.contract_id ? 'rented' : ''} ${s.active ? '' : 'inactive'}" data-id="${s.id}">
          <b>${esc(s.label)}</b><span>${s.contract_id ? esc(s.customer_name || 'Rented') : esc(s.type_name || 'Vacant')}</span></button>`).join('')}</div>`
          : '<div class="muted small">None.</div>'}</div></div>`;
    }).join('');
    board.querySelectorAll('.spot').forEach((b) => b.onclick = () => spotSheet(spots.find((s) => s.id === Number(b.dataset.id)), async () => {
      spots = await get(withLoc('/spots')); render();
    }));
  }
  document.getElementById('seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    show = b.dataset.v;
    document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  };
  render();

  function spotSheet(s, refresh) {
    const t = types.find((x) => x.id === s.spot_type_id);
    const body = document.createElement('div');
    body.className = 'stack';
    body.innerHTML = `
      <dl class="kv">
        <dt>Building</dt><dd>${esc(s.building)}</dd>
        <dt>Type</dt><dd>${esc(s.type_name || '—')}${t && t.monthly_cents != null ? ` <span class="muted small">· ${money(t.monthly_cents)}/mo</span>` : ''}</dd>
        ${s.length_ft || s.width_ft ? `<dt>Size</dt><dd>${[s.length_ft && s.length_ft + ' ft long', s.width_ft && s.width_ft + ' ft wide'].filter(Boolean).join(', ')}</dd>` : ''}
        ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
        <dt>Status</dt><dd>${s.contract_id
          ? `<a href="#/customers/${s.customer_id}" data-close><b>${esc(s.customer_name)}</b></a>${s.boat_name || s.boat_make ? `<br><span class="muted small">${esc([s.boat_name, s.boat_make, s.boat_model].filter(Boolean).join(' · '))}</span>` : ''}
             ${s.rate_cents != null ? `<br><span class="muted small">${CYCLE[s.billing_cycle]} · ${money(s.rate_cents)}</span>` : ''}`
          : s.active ? '<span class="badge good">Vacant</span>' : '<span class="badge">Not in use</span>'}</dd>
      </dl>
      ${!s.contract_id && s.active ? '<div id="matches"></div>' : ''}
      ${!s.contract_id && s.active && can('contracts.edit') ? '<div class="card pad" id="rent"></div>' : ''}
      <div id="panels" class="stack"></div>`;
    const sh = sheet({ title: `Spot ${s.label}`, body, wide: true });
    body.querySelectorAll('[data-close]').forEach((a) => a.onclick = () => sh.close());
    const panels = body.querySelector('#panels');
    notesPanel(panels, 'spot', s.id);
    photosPanel(panels, 'spot', s.id, undefined, 'Photos');
    const mEl = body.querySelector('#matches');
    if (mEl) matchesFor(s.id).then((list) => {
      if (!list.length) return;
      mEl.innerHTML = `<div class="match"><b>${list.length} on the waitlist fit this spot</b>
        <ul class="list" style="margin-top:6px">${list.slice(0, 5).map((w, i) => `<li><a class="item" href="#/waitlist" style="padding:8px 0;min-height:0" data-close>
          <div class="main"><div class="title">${i + 1}. ${esc(w.customer_name || w.name)}</div><div class="sub">${esc([w.boat_length_ft ? w.boat_length_ft + ' ft' : '', w.phone].filter(Boolean).join(' · '))}</div></div></a></li>`).join('')}</ul></div>`;
      mEl.querySelectorAll('[data-close]').forEach((a) => a.onclick = () => sh.close());
    }).catch(() => {});
    const rent = body.querySelector('#rent');
    if (rent) rentForm(rent, s, () => { sh.close(); refresh(); });
  }
}

async function rentForm(el, spot, done) {
  const customers = await get('/customers?status=');
  el.innerHTML = `<h3 style="margin-bottom:12px">Rent this spot</h3>
    <form class="grid2">
      <label class="field" style="grid-column:1/-1"><span>Customer</span><select name="customer_id"><option value="">— Choose —</option>
        ${customers.filter((c) => c.status !== 'inactive').map((c) => `<option value="${c.id}">${esc(fullName(c))}${c.spots ? ' (has ' + esc(c.spots) + ')' : ''}</option>`).join('')}</select>
        <small>New customer? <a href="#/customers?new">Add them first</a>.</small></label>
      ${fields([
        { name: 'billing_cycle', label: 'Billing', type: 'select', options: Object.entries(CYCLE) },
        { name: 'rate', label: 'Rate per cycle ($)', type: 'money' },
        { name: 'start_date', label: 'Start date', type: 'date', value: today() },
      ])}
      <div style="grid-column:1/-1"><button class="btn primary block" type="submit">Rent spot ${esc(spot.label)}</button></div>
    </form>`;
  const f = el.querySelector('form');
  const fill = async () => {
    const { rate_cents } = await get(`/rate-for?spot_id=${spot.id}&cycle=${f.billing_cycle.value}`);
    f.rate.value = rate_cents ? dollars(rate_cents) : '';
  };
  f.billing_cycle.onchange = () => fill().catch(fail);
  fill().catch(fail);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f);
    if (!v.customer_id) return fail(new Error('Choose a customer.'));
    try {
      await post(`/customers/${v.customer_id}/contracts`, { ...v, spot_id: spot.id, next_bill_date: v.start_date });
      toast(`Spot ${spot.label} rented`);
      done();
    } catch (err) { fail(err); }
  };
}
