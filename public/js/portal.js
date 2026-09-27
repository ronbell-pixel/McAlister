// Customer portal: storage, invoices (pay online), agreements, contact info.
const app = document.getElementById('app');
const q = new URLSearchParams(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const boat = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M12 4l6 8h-6"/><path d="M3 15h18l-2.5 4h-13z"/><path d="M2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1"/></svg>';
const CYCLE = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.style.bottom = '24px'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
function brand(c) {
  if (c && /^#[0-9a-f]{6}$/i.test(c.brandColor || '')) document.documentElement.style.setProperty('--brand', c.brandColor);
  if (c) document.title = `My account — ${c.name}`;
}
const header = (c, signedIn) => `<div class="top"><div class="brandmark">${boat}</div><b>${esc(c.name)}</b>${signedIn ? '<button class="btn sm" id="out">Sign out</button>' : ''}</div>`;

function loginView(company) {
  brand(company);
  app.innerHTML = `${header(company)}
    <div class="card pad" style="max-width:440px;margin:40px auto 0">
      <h1 style="font-size:22px;margin-bottom:6px">Your storage account</h1>
      <p class="muted" style="margin-top:0">Enter the email address we have on file. We’ll send you a link to sign in — no password needed.</p>
      ${q.has('expired') ? '<div class="info" style="background:var(--warn-soft)">That sign-in link has expired or was already used. Request a new one below.</div>' : ''}
      <form id="f"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
        <button class="btn primary block" type="submit">Email me a sign-in link</button></form>
      <div id="msg"></div>
      ${company.phone ? `<p class="muted small" style="text-align:center;margin-bottom:0">Need help? Call ${esc(company.phone)}</p>` : ''}
    </div>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      await call('POST', '/api/public/portal/request-link', { email: e.target.email.value });
      document.getElementById('msg').innerHTML = '<div class="info" style="margin-top:14px">If that email is on file, a sign-in link is on its way. Check your inbox (and spam folder).</div>';
    } catch (err) { document.getElementById('msg').innerHTML = `<p class="err" style="margin-top:12px">${esc(err.message)}</p>`; btn.disabled = false; }
  };
}

async function load() {
  let d;
  try { d = await call('GET', '/api/portal/me'); }
  catch (e) { if (e.status === 401) return loginView(e.data.company || { name: 'Storage' }); app.innerHTML = `<div class="card done">${esc(e.message)}</div>`; return; }
  brand(d.company);

  // Back from paying online.
  if (q.get('paid') && q.get('session_id')) {
    try {
      const r = await call('POST', '/api/portal/confirm', { invoice_id: q.get('paid'), session_id: q.get('session_id') });
      history.replaceState(null, '', '/portal');
      if (r.status === 'paid') { toast('Payment received — thank you!'); d = await call('GET', '/api/portal/me'); }
      else toast('We’re still confirming your payment. It will show here shortly.');
    } catch (e) { toast(e.message, 'error'); }
  }
  render(d);
}

function render(d) {
  const c = d.customer;
  const open = d.invoices.filter((i) => i.status === 'sent');
  const balance = open.reduce((a, i) => a + i.total_cents, 0);
  const t = today();
  const pending = d.agreements.filter((a) => a.status === 'sent' && a.token);
  app.innerHTML = `${header(d.company, true)}
    <h1 class="hello" style="font-size:24px">Hi ${esc(c.first_name || c.company || '')}</h1>
    ${pending.length ? `<div class="card pad" style="margin-bottom:16px;border-color:var(--warn)"><b>Please sign your storage agreement</b>
      <div class="muted small" style="margin:4px 0 10px">It takes about a minute.</div>
      ${pending.map((a) => `<a class="btn primary" href="/sign/${esc(a.token)}">Review and sign</a>`).join(' ')}</div>` : ''}

    <div class="kpis" style="grid-template-columns:1fr 1fr">
      <div class="card kpi ${open.some((i) => i.due_date < t) ? 'alert' : ''}"><div class="label">Balance due</div><div class="value">${money(balance)}</div>
        <div class="kpi-note">${open.length ? `${open.length} open invoice${open.length === 1 ? '' : 's'}` : 'All paid up — thank you!'}</div></div>
      <div class="card kpi"><div class="label">Next bill</div><div class="value" style="font-size:20px">${d.rentals[0] ? date(d.rentals[0].next_bill_date) : '—'}</div>
        <div class="kpi-note">${d.rentals[0] ? `${money(d.rentals[0].rate_cents)} / ${CYCLE[d.rentals[0].billing_cycle]}` : ''}</div></div>
    </div>

    <div class="stack">
      <div class="card"><div class="card-head"><h3>Invoices</h3></div>
        <ul class="list" id="invlist">${d.invoices.length ? d.invoices.map((i, n) => `<li ${i.status === 'paid' && n >= open.length + 6 ? 'class="older hidden"' : ''}><div class="item">
          <div class="main"><div class="title">${money(i.total_cents)}</div>
          <div class="sub">${esc(i.number)} · ${i.status === 'paid' ? `paid ${date(i.paid_at)}` : `due ${date(i.due_date)}`}</div></div>
          ${i.status === 'paid' ? '<span class="badge good">Paid</span>' : i.due_date < t ? '<span class="badge bad">Past due</span>' : '<span class="badge warn">Open</span>'}
          <a class="btn sm" href="/api/portal/invoices/${i.id}/pdf" target="_blank" rel="noopener">View</a>
          ${i.status === 'sent' && d.payOnline ? `<button class="btn sm primary" data-pay="${i.id}">Pay</button>` : ''}
        </div></li>`).join('') : '<li class="empty">No invoices yet.</li>'}
          ${d.invoices.length > open.length + 6 ? '<li><button class="btn ghost block" id="more">Show older invoices</button></li>' : ''}</ul>
        ${open.length && !d.payOnline ? `<div class="card-body muted small" style="border-top:1px solid var(--line)">To pay, mail a check or call ${esc(d.company.phone || 'us')}.</div>` : ''}
      </div>

      <div class="card"><div class="card-head"><h3>My storage</h3></div><div class="card-body stack" style="gap:12px">
        ${d.rentals.length ? d.rentals.map((r) => `<div class="rent"><div class="big">Spot ${esc(r.spot || '—')}</div>
          <div class="muted">${esc([r.location, r.building].filter(Boolean).join(' · '))}</div>
          <div class="small">${money(r.rate_cents)} per ${CYCLE[r.billing_cycle]} · since ${date(r.start_date)}${r.end_date ? ` · ends ${date(r.end_date)}` : ''}</div>
          ${r.boat_name || r.boat_make ? `<div class="small muted">${esc([r.boat_name, r.boat_make, r.boat_model].filter(Boolean).join(' · '))}</div>` : ''}</div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:0">')
          : '<div class="muted">No active storage.</div>'}
        ${d.boats.some((b) => b.insurance_expires) ? `<div class="small">${d.boats.filter((b) => b.insurance_expires).map((b) => `Insurance on ${esc(b.name || b.make || 'your boat')}: ${b.insurance_expires < t ? '<b style="color:var(--bad)">expired</b>' : 'expires'} ${date(b.insurance_expires)}`).join('<br>')}</div>` : ''}
      </div></div>

      ${d.agreements.some((a) => a.status === 'signed') ? `<div class="card"><div class="card-head"><h3>Signed agreements</h3></div><ul class="list">
        ${d.agreements.filter((a) => a.status === 'signed').map((a) => `<li><a class="item" href="/api/portal/agreements/${a.id}/pdf" target="_blank" rel="noopener">
          <div class="main"><div class="title">${esc(a.title)}</div><div class="sub">Signed ${date(a.signed_at)}</div></div><span class="btn sm">Download</span></a></li>`).join('')}</ul></div>` : ''}

      <div class="card pad"><h3 style="margin-bottom:12px">My contact info</h3>
        <form id="info" class="grid2">
          ${[['phone', 'Mobile phone', 'tel'], ['alt_phone', 'Other phone', 'tel'], ['email', 'Email', 'email'], ['address', 'Street address', 'text', true], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ['emergency_name', 'Emergency contact'], ['emergency_phone', 'Emergency phone', 'tel']]
            .map(([k, l, type = 'text', full]) => `<label class="field" ${full ? 'style="grid-column:1/-1"' : ''}><span>${l}</span><input name="${k}" type="${type}" value="${esc(c[k] || '')}"></label>`).join('')}
          <label class="check" style="grid-column:1/-1"><input type="checkbox" name="sms_ok" ${c.sms_ok ? 'checked' : ''}> <span>Text me reminders and updates</span></label>
          <div style="grid-column:1/-1"><button class="btn primary" type="submit">Save changes</button></div>
        </form></div>

      <p class="muted small" style="text-align:center">${esc(d.company.name)}${d.company.phone ? ' · ' + esc(d.company.phone) : ''}${d.company.address ? '<br>' + esc(d.company.address) : ''}</p>
    </div>`;

  const more = document.getElementById('more');
  if (more) more.onclick = () => { app.querySelectorAll('.older').forEach((x) => x.classList.remove('hidden')); more.parentElement.remove(); };
  document.getElementById('out').onclick = async () => { await call('POST', '/api/portal/logout'); location.href = '/portal'; };
  app.querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = '…';
    try { const r = await call('POST', `/api/portal/invoices/${b.dataset.pay}/checkout`); location.href = r.url; }
    catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Pay'; }
  });
  const f = document.getElementById('info');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    f.querySelectorAll('input[name]').forEach((i) => { body[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
    try { await call('PUT', '/api/portal/me', body); toast('Saved — thank you!'); } catch (err) { toast(err.message, 'error'); }
  };
}
load();
