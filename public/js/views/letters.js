import { get, post, put, del, esc, date, icon, toast, fail, sheet, confirmSheet, fields, formData, fullName } from '../ui.js';
import { main, state, withLoc, locationName } from '../app.js';

const CATS = { thanks: ['Thank you', 'good'], warning: ['Warning', 'bad'], notice: ['Notice', 'brand'], general: ['General', ''] };
const MERGE = ['first_name', 'customer_name', 'company_name', 'company_phone', 'spot', 'building', 'location', 'boat', 'rate', 'billing_period',
  'balance_due', 'overdue_total', 'overdue_list', 'oldest_due_date', 'end_date', 'today', 'portal_link'];

export async function lettersPage() {
  const tab = state.query.get('tab') || 'send';
  main().innerHTML = `<div class="page-head"><h1>Letters</h1></div>
    <div class="segmented" id="seg" style="margin-bottom:16px">${[['send', 'Send to a group'], ['templates', 'Templates'], ['history', 'Sent letters']].map(([k, l]) =>
      `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pane"></div>`;
  document.getElementById('seg').onclick = (e) => { const b = e.target.closest('button'); if (b) location.hash = `#/letters?tab=${b.dataset.k}`; };
  const pane = document.getElementById('pane');
  if (tab === 'templates') await templatesPane(pane);
  else if (tab === 'history') await historyPane(pane);
  else await sendPane(pane);
}

// ---------- Bulk send ----------
async function sendPane(pane) {
  const [tpls, auds] = await Promise.all([get('/letter-templates'), get(withLoc('/letters/audiences'))]);
  const emailOn = state.session.features.email;
  pane.innerHTML = `<div class="card pad">
    <p class="muted" style="margin-top:0">Send the same letter to a group — for example a rate change to everyone, or a warning to everyone past due.
      Each letter fills in that customer’s own details and is saved to their record.${locationName() ? ` <b>Only customers at ${esc(locationName())}.</b>` : ''}</p>
    <form class="grid2">
      ${fields([
        { name: 'template_id', label: 'Letter', type: 'select', options: tpls.map((t) => [t.id, t.name]) },
        { name: 'audience', label: 'Send to', type: 'select', options: auds.map((a) => [a.key, `${a.label} (${a.count})`]) },
        { name: 'via', label: 'How', type: 'select', full: true, options: emailOn
          ? [['email_or_print', 'Email if they have an address, otherwise print'], ['print', 'Print them all']]
          : [['print', 'Print them all (email isn’t set up)']] },
      ])}
      <div class="row" style="grid-column:1/-1"><button type="button" class="btn" id="pv">Preview</button><button type="submit" class="btn primary">${icon.send} Send letters</button></div>
    </form></div>`;
  const f = pane.querySelector('form');
  pane.querySelector('#pv').onclick = async () => {
    try {
      const r = await get(`/letters/preview?template_id=${f.template_id.value}`);
      sheet({ title: r.subject, wide: true, body: `<p class="muted small" style="margin-top:0">Filled in with one customer as an example. Each letter gets that customer’s own details.</p><div class="agreement-text">${esc(r.body)}</div>` });
    } catch (e) { fail(e); }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f);
    const a = auds.find((x) => x.key === v.audience);
    const t = tpls.find((x) => String(x.id) === v.template_id);
    if (!a.count) return fail(new Error('Nobody is in that group.'));
    if (!(await confirmSheet('Send letters?', `Send “${t.name}” to ${a.count} customer${a.count === 1 ? '' : 's'}?`, 'Send'))) return;
    try {
      const r = await post(withLoc('/letters/bulk'), v);
      sheet({
        title: 'Letters done',
        body: `<p style="margin-top:0">${r.emailed ? `${r.emailed} emailed. ` : ''}${r.printed ? `${r.printed} ready to print.` : ''}</p>
          ${r.print_url ? `<a class="btn primary block" href="${esc(r.print_url)}" target="_blank" rel="noopener">${icon.printer} Open PDF to print</a>` : ''}
          ${r.failed.length ? `<p class="err">${r.failed.length} failed: ${esc(r.failed[0].customer)} — ${esc(r.failed[0].error)}</p>` : ''}
          <p class="muted small">A copy of each letter is saved to the customer’s Photos & documents.</p>`,
      });
    } catch (err) { fail(err); }
  };
}

// ---------- Templates ----------
async function templatesPane(pane) {
  const tpls = await get('/letter-templates');
  pane.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="add">${icon.plus} New template</button></div>
    <div class="card"><ul class="list">${tpls.map((t) => `<li><div class="item" data-id="${t.id}" style="cursor:pointer">
      <div class="main"><div class="title">${esc(t.name)}</div><div class="sub">${esc(t.subject)}</div></div>
      <span class="badge ${CATS[t.category]?.[1] || ''}">${CATS[t.category]?.[0] || t.category}</span>${icon.chevron.replace('<svg', '<svg class="chev"')}</div></li>`).join('')}</ul></div>`;
  const reload = () => templatesPane(pane).catch(fail);
  pane.querySelector('#add').onclick = () => templateForm(null, reload);
  pane.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => templateForm(tpls.find((t) => t.id === Number(r.dataset.id)), reload));
}

function templateForm(t, reload) {
  const s = sheet({
    title: t ? 'Edit letter template' : 'New letter template',
    wide: true,
    body: `<form>
      <div class="grid2">${fields([
        { name: 'name', label: 'Template name' },
        { name: 'category', label: 'Type', type: 'select', options: Object.entries(CATS).map(([k, v]) => [k, v[0]]) },
      ], t || { category: 'general' })}</div>
      ${fields([{ name: 'subject', label: 'Subject / “RE:” line' }], t || {})}
      <label class="field"><span>Letter text</span><textarea class="template" name="body" style="min-height:280px">${esc(t ? t.body : 'Dear {{first_name}},\n\n')}</textarea>
        <small>“Sincerely” and your company name are added at the bottom automatically.</small></label>
      <div class="muted small" style="margin:-6px 0 6px">Tap to insert:</div>
      <div class="chips">${MERGE.map((m) => `<button type="button" class="chip">{{${m}}}</button>`).join('')}</div>
    </form>`,
    buttons: [
      ...(t ? [{ label: 'Delete', kind: 'danger', onClick: async (close) => {
        if (!(await confirmSheet('Delete template?', `Delete “${t.name}”? Letters already sent are kept.`, 'Delete', true))) return;
        await del(`/letter-templates/${t.id}`); close(); reload();
      } }] : []),
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        if (t) await put(`/letter-templates/${t.id}`, v); else await post('/letter-templates', v);
        close(); toast('Template saved'); reload();
      } },
    ],
  });
  const ta = s.body.querySelector('textarea');
  s.body.querySelector('.chips').onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    ta.setRangeText(b.textContent, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus();
  };
}

// ---------- History ----------
async function historyPane(pane) {
  const rows = await get('/letters');
  pane.innerHTML = `<div class="card">${rows.length ? `<ul class="list">${rows.map((l) => `<li><div class="item">
      <div class="main"><div class="title"><a href="#/customers/${l.customer_id || ''}">${esc(l.customer_name)}</a> · ${esc(l.subject)}</div>
      <div class="sub">${l.via === 'email' ? 'Emailed' : 'Printed'} ${date(l.created_at)}${l.created_by_name ? ' by ' + esc(l.created_by_name) : ''}</div></div>
      ${l.attachment_id ? `<a class="btn sm" href="/api/attachments/${l.attachment_id}/file" target="_blank" rel="noopener">View</a>` : ''}</div></li>`).join('')}</ul>`
    : '<div class="empty">No letters sent yet.</div>'}</div>`;
}

// ---------- One letter to one customer (used on the customer page) ----------
export async function letterToCustomer(customer, onDone) {
  const tpls = await get('/letter-templates');
  const emailOn = state.session.features.email && customer.email;
  const s = sheet({
    title: `Letter to ${fullName(customer)}`,
    wide: true,
    body: `<form>
      ${fields([{ name: 'template_id', label: 'Start from', type: 'select', options: tpls.map((t) => [t.id, t.name]) }])}
      ${fields([{ name: 'subject', label: 'Subject' }])}
      <label class="field"><span>Letter text (edit anything before sending)</span><textarea class="template" name="body" style="min-height:300px;font-family:inherit;font-size:15px"></textarea></label>
      ${!emailOn ? `<p class="muted small">${customer.email ? 'Email isn’t set up, so this letter will be printed.' : 'No email on file, so this letter will be printed.'}</p>` : ''}
    </form>`,
    buttons: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: `${icon.printer} Print`, onClick: async (close) => {
        const v = formData(s.body);
        const r = await post('/letters/send', { customer_id: customer.id, template_id: v.template_id, subject: v.subject, body: v.body, via: 'print' });
        close();
        sheet({ title: 'Letter ready', body: `<a class="btn primary block" href="${esc(r.pdf_url)}" target="_blank" rel="noopener">${icon.printer} Open letter to print</a><p class="muted small">Saved to the customer’s documents.</p>` });
        onDone && onDone();
      } },
      ...(emailOn ? [{ label: `${icon.mail} Email`, kind: 'primary', onClick: async (close) => {
        const v = formData(s.body);
        await post('/letters/send', { customer_id: customer.id, template_id: v.template_id, subject: v.subject, body: v.body, via: 'email' });
        close(); toast('Letter emailed'); onDone && onDone();
      } }] : []),
    ],
  });
  const f = s.body.querySelector('form');
  const fill = async () => {
    try {
      const r = await get(`/letters/preview?template_id=${f.template_id.value}&customer_id=${customer.id}`);
      f.subject.value = r.subject; f.body.value = r.body;
    } catch (e) { fail(e); }
  };
  f.template_id.onchange = fill;
  fill();
}
