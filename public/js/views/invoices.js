import { get, post, put, esc, money, dollars, date, icon, toast, fail, sheet, confirmSheet, fields, formData, fullName, today, statusBadge } from '../ui.js';
import { main, state, clearQuery, withLoc } from '../app.js';

const TABS = [['draft', 'Drafts'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['', 'All']];
const CYCLE = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export async function invoiceList() {
  const q = state.query;
  let tab = q.has('overdue') ? 'overdue' : (sessionStorage.getItem('invTab') ?? 'draft');
  let search = '';
  const customerFilter = q.get('customer');
  const selected = new Set();

  main().innerHTML = `
    <div class="page-head"><h1>Invoices</h1>
      <div class="actions">
        <button class="btn" id="remind">${icon.bell} Reminders</button>
        <button class="btn" id="newInv">${icon.plus} New invoice</button>
        <button class="btn primary" id="run">${icon.play} Run billing</button>
      </div></div>
    <div class="row" style="margin-bottom:12px">
      <div class="search">${icon.search}<input type="search" id="q" placeholder="Search number or customer…" aria-label="Search invoices"></div>
      <div class="segmented" id="seg">${TABS.map(([v, l]) => `<button data-v="${v}" class="${v === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card" id="bulk" style="margin-bottom:12px;display:none"><div class="card-body row" style="padding:10px 12px">
      <b id="selCount" style="flex:1"></b>
      <a class="btn sm" id="printSel" target="_blank" rel="noopener">${icon.printer} Print</a>
      <button class="btn sm" id="mailedSel">${icon.check} Mark mailed</button>
    </div></div>
    <div id="draftBar"></div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;

  const listEl = document.getElementById('list');
  const bulk = document.getElementById('bulk');

  function updateBulk() {
    bulk.style.display = selected.size ? '' : 'none';
    document.getElementById('selCount').textContent = `${selected.size} selected`;
    document.getElementById('printSel').href = `/api/invoices-pdf?ids=${[...selected].join(',')}`;
  }

  async function load() {
    const params = new URLSearchParams({ status: tab, q: search });
    if (customerFilter) params.set('customer_id', customerFilter);
    const rows = await get(withLoc(`/invoices?${params}`));
    selected.clear(); updateBulk();
    const draftBar = document.getElementById('draftBar');
    const draftCount = tab === 'draft' ? rows.length : 0;
    draftBar.innerHTML = draftCount ? `<div class="card pad" style="margin-bottom:12px"><div class="spread" style="flex-wrap:wrap">
      <div><b>${draftCount} draft${draftCount === 1 ? '' : 's'} ready to send</b><div class="muted small">Emails customers who have an address; the rest are put together in one PDF to print and mail.</div></div>
      <button class="btn primary" id="sendAll">${icon.send} Send all drafts</button></div></div>` : '';
    const sendAll = document.getElementById('sendAll');
    if (sendAll) sendAll.onclick = () => sendDrafts(load);

    if (!rows.length) { listEl.innerHTML = `<div class="empty">${tab === 'draft' ? 'No drafts. Use <b>Run billing</b> to create this period’s invoices.' : 'No invoices here.'}</div>`; return; }
    const total = rows.reduce((a, r) => a + (r.status === 'void' ? 0 : r.total_cents), 0);
    listEl.innerHTML = `<ul class="list">${rows.map((i) => `<li><div class="item">
        <input type="checkbox" data-sel="${i.id}" aria-label="Select ${esc(i.number)}">
        <div class="main" data-open="${i.id}" style="cursor:pointer">
          <div class="title">${esc(i.customer_name || i.company)}</div>
          <div class="sub">${esc(i.number)} · ${i.status === 'paid' ? 'paid ' + date(i.paid_at) : 'due ' + date(i.due_date)}${i.sent_via ? ` · ${i.sent_via === 'email' ? 'emailed' : 'mailed'}` : ''}</div>
        </div>
        <div class="end" data-open="${i.id}" style="cursor:pointer"><div class="num" style="font-weight:650">${money(i.total_cents)}</div>${statusBadge(i)}</div>
      </div></li>`).join('')}
      <li><div class="item"><div class="main muted small">${rows.length} invoice${rows.length === 1 ? '' : 's'}</div><div class="end num"><b>${money(total)}</b></div></div></li></ul>`;
    listEl.querySelectorAll('[data-open]').forEach((el) => el.onclick = () => invoiceDetail(Number(el.dataset.open), load));
    listEl.querySelectorAll('[data-sel]').forEach((cb) => cb.onchange = () => {
      if (cb.checked) selected.add(Number(cb.dataset.sel)); else selected.delete(Number(cb.dataset.sel));
      updateBulk();
    });
  }

  let t;
  document.getElementById('q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim(); load().catch(fail); }, 200); };
  document.getElementById('seg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.v; sessionStorage.setItem('invTab', tab);
    document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(fail);
  };
  document.getElementById('run').onclick = () => runBilling(load);
  document.getElementById('newInv').onclick = () => invoiceEditor(null, load);
  document.getElementById('remind').onclick = () => remindersSheet().catch(fail);
  document.getElementById('mailedSel').onclick = async () => {
    await post('/invoices/mark-sent', { ids: [...selected] }).catch(fail);
    toast('Marked as mailed'); load();
  };

  await load();
  if (q.has('reminders')) { clearQuery(); remindersSheet().catch(fail); }
  else if (q.has('run')) { clearQuery(); runBilling(load); }
  else if (q.get('open')) { const id = Number(q.get('open')); clearQuery(); invoiceDetail(id, load); }
  else if (q.has('new')) { const cid = q.get('new'); clearQuery(); invoiceEditor(null, load, cid); }
}

// ---------- Billing run ----------
async function runBilling(reload) {
  const pv = await get('/billing/preview');
  const s = sheet({
    title: 'Run billing',
    wide: true,
    body: `<p style="margin-top:0">Creates draft invoices for every active rental whose next billing period starts on or before
      <input type="date" id="through" value="${pv.through}" style="display:inline-block;width:auto;min-height:36px;padding:4px 8px"> .
      You can review drafts before anything is sent.</p>
      <div id="pv"></div>`,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: `${icon.play} Create drafts`, kind: 'primary', onClick: async (close) => {
        const r = await post('/billing/run', { through: s.body.querySelector('#through').value });
        close();
        toast(r.created ? `${r.created} draft invoice${r.created === 1 ? '' : 's'} created` : 'Nothing to bill yet');
        sessionStorage.setItem('invTab', 'draft');
        if (location.hash.startsWith('#/invoices')) { document.querySelector('#seg [data-v="draft"]')?.click(); reload(); }
        else location.hash = '#/invoices';
      } },
    ],
  });
  const showPreview = (list) => {
    s.body.querySelector('#pv').innerHTML = list.length
      ? `<div class="card scroll-x"><table class="data"><thead><tr><th>Customer</th><th>Spot</th><th>Billing</th><th>Period starts</th><th class="r">Amount</th></tr></thead>
         <tbody>${list.map((k) => `<tr><td>${esc(k.customer_name || k.company)}</td><td>${esc(k.spot_label || '—')}</td><td>${CYCLE[k.billing_cycle]}</td><td>${date(k.next_bill_date)}</td><td class="r num">${money(k.rate_cents)}</td></tr>`).join('')}</tbody></table></div>
         <p class="muted small">${list.length} rental${list.length === 1 ? '' : 's'} · ${money(list.reduce((a, k) => a + k.rate_cents, 0))} (rentals behind by more than one period get one invoice per period)</p>`
      : '<div class="empty">No rentals are due to bill through this date.</div>';
  };
  showPreview(pv.contracts);
  s.body.querySelector('#through').onchange = async (e) => {
    try { showPreview((await get(`/billing/preview?through=${e.target.value}`)).contracts); } catch (err) { fail(err); }
  };
}

async function sendDrafts(reload) {
  if (!state.session.features.email) {
    const ok = await confirmSheet('Email isn’t set up', 'All drafts will be put into one PDF for you to print and mail. (An admin can connect email under Setup → Email.)', 'Make PDF');
    if (!ok) return;
  } else if (!(await confirmSheet('Send all drafts?', 'Customers with an email address get their invoice by email. The rest go into one PDF to print.', 'Send'))) return;
  const r = await post('/invoices/send-drafts');
  if (r.toPrint.length) {
    const s = sheet({
      title: 'Print the rest',
      body: `<p style="margin-top:0">${r.emailed ? `${r.emailed} emailed. ` : ''}${r.toPrint.length} invoice${r.toPrint.length === 1 ? '' : 's'} need printing (no email on file${state.session.features.email ? '' : ', or email isn’t set up'}).</p>
        <a class="btn primary block" target="_blank" rel="noopener" href="/api/invoices-pdf?ids=${r.toPrint.join(',')}">${icon.printer} Open PDF to print</a>
        <p class="muted small">After printing, mark them as mailed so they show as Open.</p>`,
      buttons: [
        { label: 'Later', onClick: (close) => { close(); reload(); } },
        { label: `${icon.check} Mark as mailed`, kind: 'primary', onClick: async (close) => { await post('/invoices/mark-sent', { ids: r.toPrint }); close(); toast('Marked as mailed'); reload(); } },
      ],
    });
    return s;
  }
  toast(`${r.emailed} invoice${r.emailed === 1 ? '' : 's'} emailed`);
  if (r.failed.length) fail(new Error(`${r.failed.length} failed: ${r.failed[0].error}`));
  reload();
}

// ---------- Detail ----------
async function invoiceDetail(id, reload) {
  const { invoice: i, items, customer: c } = await get(`/invoices/${id}`);
  const hasEmail = Boolean(c.email);
  const open = i.status === 'draft' || i.status === 'sent';
  const s = sheet({
    title: `Invoice ${i.number}`,
    wide: true,
    body: `
      <div class="spread" style="align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
        <div><a href="#/customers/${c.id}" data-close><b style="font-size:17px">${esc(fullName(c))}</b></a>
          <div class="muted small">${esc(c.email || 'No email on file')}</div></div>
        <div style="text-align:right">${statusBadge(i)}<div class="muted small" style="margin-top:4px">Issued ${date(i.issue_date)} · Due ${date(i.due_date)}</div>
          ${i.sent_at ? `<div class="muted small">${i.sent_via === 'email' ? 'Emailed' : 'Mailed'} ${date(i.sent_at)}</div>` : ''}
          ${i.status === 'paid' ? `<div class="small" style="color:var(--good)">Paid ${date(i.paid_at)}${i.paid_method ? ' · ' + esc(i.paid_method) : ''}</div>` : ''}</div>
      </div>
      <div class="card"><ul class="list">${items.map((it) => `<li><div class="item">
        <div class="main"><div style="white-space:normal">${esc(it.description)}</div>${it.qty !== 1 ? `<div class="sub">${it.qty} × ${money(it.unit_cents)}</div>` : ''}</div>
        <div class="end num" style="font-weight:600">${money(it.amount_cents)}</div></div></li>`).join('')}</ul></div>
      <div class="total-row">Total ${money(i.total_cents)}</div>
      ${i.notes ? `<p class="muted small" style="white-space:pre-wrap">${esc(i.notes)}</p>` : ''}
      <div class="row" style="margin-top:16px">
        <a class="btn" target="_blank" rel="noopener" href="/api/invoices-pdf?ids=${i.id}">${icon.printer} Print / PDF</a>
        ${open ? `<button class="btn" data-a="edit">${icon.edit} Edit</button>` : ''}
        ${open ? `<button class="btn ghost danger" data-a="void">Void</button>` : ''}
        ${i.status === 'paid' ? `<button class="btn ghost" data-a="unpaid">Mark unpaid</button>` : ''}
      </div>`,
    buttons: open ? [
      { label: `${icon.send} Email${i.status === 'sent' ? ' again' : ''}`, kind: hasEmail ? '' : 'hidden', onClick: async (close) => {
        await post(`/invoices/${i.id}/email`); close(); toast('Invoice emailed'); reload();
      } },
      ...(i.status === 'draft' ? [{ label: `${icon.check} Mark mailed`, onClick: async (close) => {
        await post('/invoices/mark-sent', { ids: [i.id] }); close(); toast('Marked as mailed'); reload();
      } }] : []),
      { label: '$ Record payment', kind: 'primary', onClick: async (close) => { close(); paymentForm(i, reload); } },
    ] : [],
  });
  s.body.querySelector('[data-close]').onclick = () => s.close();
  s.body.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    try {
      if (b.dataset.a === 'edit') { s.close(); invoiceEditor({ invoice: i, items }, reload); }
      if (b.dataset.a === 'void' && (await confirmSheet('Void invoice?', `${i.number} will be kept for records but no longer counted as owed.`, 'Void', true))) {
        await post(`/invoices/${i.id}/void`); s.close(); toast('Voided'); reload();
      }
      if (b.dataset.a === 'unpaid') { await post(`/invoices/${i.id}/unpaid`); s.close(); reload(); }
    } catch (e) { fail(e); }
  });
}

function paymentForm(i, reload) {
  const s = sheet({
    title: `Record payment · ${money(i.total_cents)}`,
    body: `<form class="grid2">${fields([
      { name: 'method', label: 'Paid by', type: 'select', options: ['Check', 'Cash', 'Card', 'ACH / bank transfer', 'Other'] },
      { name: 'date', label: 'Date received', type: 'date', value: today() },
    ])}</form><p class="muted small">Online card payments (Stripe) can be switched on later — see the plan’s Phase 3.</p>`,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: `${icon.check} Mark paid`, kind: 'primary', onClick: async (close) => {
        await post(`/invoices/${i.id}/paid`, formData(s.body)); close(); toast('Payment recorded'); reload();
      } },
    ],
  });
}

// ---------- New / edit ----------
async function invoiceEditor(existing, reload, presetCustomer) {
  const customers = existing ? [] : await get('/customers?status=');
  const inv = existing?.invoice;
  const items = existing?.items?.length ? existing.items.map((it) => ({ description: it.description, qty: it.qty, unit: dollars(it.unit_cents) })) : [{ description: '', qty: 1, unit: '' }];

  const s = sheet({
    title: inv ? `Edit ${inv.number}` : 'New invoice',
    wide: true,
    body: `<form>
      ${inv ? '' : `<label class="field"><span>Customer</span><select name="customer_id" required><option value="">— Choose —</option>
        ${customers.map((c) => `<option value="${c.id}" ${String(c.id) === String(presetCustomer) ? 'selected' : ''}>${esc(fullName(c))}${c.spots ? ' · ' + esc(c.spots) : ''}</option>`).join('')}</select></label>`}
      <div class="grid2">${fields([
        { name: 'issue_date', label: 'Invoice date', type: 'date', value: inv?.issue_date || today() },
        { name: 'due_date', label: 'Due date', type: 'date', value: inv?.due_date || '', hint: inv ? '' : 'Leave blank to use your standard terms' },
      ])}</div>
      <div class="line-items"><div class="li small muted" style="margin-bottom:4px"><span>Description</span><span>Qty</span><span>Price ($)</span><span></span></div><div id="lines"></div>
        <button type="button" class="btn sm" id="addLine">${icon.plus} Add line</button></div>
      <div class="total-row" id="total"></div>
      ${fields([{ name: 'notes', label: 'Notes on invoice (optional)', type: 'textarea', rows: 2, value: inv?.notes || '' }])}
    </form>`,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: inv ? 'Save' : 'Create draft', kind: 'primary', onClick: async (close) => {
        const f = s.body.querySelector('form');
        const lines = [...s.body.querySelectorAll('#lines .li')].map((r) => ({
          description: r.querySelector('[data-f=d]').value, qty: r.querySelector('[data-f=q]').value, unit: r.querySelector('[data-f=u]').value,
        })).filter((l) => l.description.trim());
        const body = { issue_date: f.issue_date.value, due_date: f.due_date.value, notes: f.notes.value, items: lines };
        if (inv) { await put(`/invoices/${inv.id}`, body); close(); toast('Saved'); reload(); }
        else {
          body.customer_id = f.customer_id.value;
          const { id } = await post('/invoices', body); close(); toast('Draft created'); reload(); invoiceDetail(id, reload);
        }
      } },
    ],
  });
  const linesEl = s.body.querySelector('#lines');
  const recalc = () => {
    let t = 0;
    linesEl.querySelectorAll('.li').forEach((r) => {
      t += (parseFloat(r.querySelector('[data-f=q]').value) || 0) * (parseFloat(r.querySelector('[data-f=u]').value.replace(/[$,]/g, '')) || 0);
    });
    s.body.querySelector('#total').textContent = 'Total ' + money(Math.round(t * 100));
  };
  const addLine = (l = { description: '', qty: 1, unit: '' }) => {
    const row = document.createElement('div');
    row.className = 'li';
    row.innerHTML = `<input data-f="d" placeholder="e.g. Shrink wrap" value="${esc(l.description)}" aria-label="Description">
      <input data-f="q" inputmode="decimal" value="${esc(l.qty)}" aria-label="Quantity">
      <input data-f="u" inputmode="decimal" placeholder="0.00" value="${esc(l.unit)}" aria-label="Price">
      <button type="button" class="btn ghost sm" aria-label="Remove line">${icon.x}</button>`;
    row.querySelector('button').onclick = () => { row.remove(); recalc(); };
    row.oninput = recalc;
    linesEl.appendChild(row);
  };
  items.forEach(addLine);
  s.body.querySelector('#addLine').onclick = () => addLine();
  s.body.querySelector('form').onsubmit = (e) => e.preventDefault();
  recalc();
}

// ---------- Reminders ----------
async function remindersSheet() {
  const [pv, log] = await Promise.all([get('/reminders/preview'), get('/reminders/log')]);
  const chan = (c) => c.map((x) => (x === 'sms' ? 'text' : 'email')).join(' + ') || '<span style="color:var(--bad)">no email / text-OK phone</span>';
  const s = sheet({
    title: 'Reminders',
    wide: true,
    body: `<div class="info" style="margin-bottom:14px">${pv.enabled
        ? `Automatic reminders are <b>on</b> — they go out once a day.${pv.lastRun ? ` Last run ${date(pv.lastRun)}.` : ''}`
        : 'Automatic reminders are <b>off</b>. You can still send these now, or turn on daily sending in Setup → Reminders.'}
        ${state.session.user.permissions.includes('setup') ? ' <a href="#/setup/reminders" data-close>Reminder settings</a>' : ''}</div>
      <h3 style="margin-bottom:8px">Ready to send (${pv.items.length})</h3>
      <div class="card">${pv.items.length ? `<ul class="list">${pv.items.map((i) => `<li><div class="item"><div class="main">
          <div class="title">${esc(i.customer_name)} <span class="badge ${i.kind === 'overdue' ? 'bad' : i.kind === 'due_soon' ? 'warn' : 'brand'}">${esc(i.label)}</span></div>
          <div class="sub">${esc(i.detail)} · by ${chan(i.channels)}</div></div></div></li>`).join('')}</ul>`
        : '<div class="empty">Nothing is due. Everyone is up to date.</div>'}</div>
      <h3 style="margin:18px 0 8px">Recently sent</h3>
      <div class="card">${log.length ? `<ul class="list">${log.slice(0, 25).map((l) => `<li><div class="item"><div class="main">
          <div class="title" style="font-weight:500">${esc(l.customer_name || '')} · ${esc(l.label)}</div>
          <div class="sub">${esc(l.detail || '')} · ${l.channel === 'sms' ? 'text' : 'email'} · ${date(l.sent_at)}</div></div>
          ${l.status === 'sent' ? '<span class="badge good">Sent</span>' : `<span class="badge bad" title="${esc(l.detail)}">Failed</span>`}</div></li>`).join('')}</ul>`
        : '<div class="empty">No reminders sent yet.</div>'}</div>`,
    buttons: [
      { label: 'Close', onClick: (c) => c() },
      ...(pv.items.some((i) => i.channels.length) ? [{ label: `${icon.send} Send ${pv.items.filter((i) => i.channels.length).length} now`, kind: 'primary', onClick: async (close) => {
        const r = await post('/reminders/run');
        close();
        toast(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'error' : '');
      } }] : []),
    ],
  });
  s.body.querySelectorAll('[data-close]').forEach((a) => a.onclick = () => s.close());
}
