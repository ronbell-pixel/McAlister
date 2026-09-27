// Public pay-online page for one invoice (link from an emailed invoice or reminder).
const app = document.getElementById('app');
const token = location.pathname.split('/').pop();
const q = new URLSearchParams(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
const boat = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M12 4l6 8h-6"/><path d="M3 15h18l-2.5 4h-13z"/><path d="M2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1"/></svg>';
const check = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function load() {
  let d;
  try {
    if (q.get('session_id')) {
      await call('POST', `/api/public/pay/${encodeURIComponent(token)}/confirm`, { session_id: q.get('session_id') }).catch(() => {});
      history.replaceState(null, '', location.pathname);
    }
    d = await call('GET', `/api/public/pay/${encodeURIComponent(token)}`);
  } catch (e) {
    app.innerHTML = `<div class="card pad" style="margin-top:40px;text-align:center"><h1 style="font-size:20px">Link not available</h1><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (/^#[0-9a-f]{6}$/i.test(d.company.brandColor || '')) document.documentElement.style.setProperty('--brand', d.company.brandColor);
  document.title = `Invoice ${d.invoice.number} — ${d.company.name}`;
  const i = d.invoice;
  const paid = i.status === 'paid';
  app.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin:8px 0 18px"><div class="brandmark">${boat}</div><b style="font-size:18px">${esc(d.company.name)}</b></div>
    <div class="card pad" style="max-width:520px;margin:0 auto">
      ${paid ? `<div style="text-align:center;padding:10px 0 4px"><div style="width:64px;height:64px;border-radius:50%;background:var(--good-soft);color:var(--good);display:grid;place-items:center;margin:0 auto 12px">${check}</div>
        <h1 style="font-size:22px">Paid — thank you!</h1><p class="muted">Invoice ${esc(i.number)} was paid ${date(i.paid_at)}.</p></div>`
      : `<div class="muted small">Invoice ${esc(i.number)} · ${esc(d.customer_name)}</div>
        <div style="font-size:34px;font-weight:700;margin:6px 0 2px">${money(i.total_cents)}</div>
        <div class="muted">Due ${date(i.due_date)}</div>
        <ul class="list" style="margin:16px 0;border-top:1px solid var(--line)">${d.items.map((it) => `<li><div class="item" style="padding:10px 0;min-height:0">
          <div class="main small" style="white-space:normal">${esc(it.description)}</div><div class="end small num">${money(it.amount_cents)}</div></div></li>`).join('')}</ul>
        ${d.payOnline ? `<button class="btn primary block" id="pay" style="min-height:52px;font-size:17px">Pay ${money(i.total_cents)} by card</button>
          <p class="muted small" style="text-align:center;margin-bottom:0">Secure checkout by Stripe. Your card details are never stored by ${esc(d.company.name)}.</p>`
          : `<p class="muted">Online payment isn’t available right now. Please mail a check${d.company.phone ? ` or call ${esc(d.company.phone)}` : ''}.</p>`}`}
    </div>`;
  const b = document.getElementById('pay');
  if (b) b.onclick = async () => {
    b.disabled = true; b.textContent = 'Opening secure checkout…';
    try { location.href = (await call('POST', `/api/public/pay/${encodeURIComponent(token)}/checkout`)).url; }
    catch (e) { b.disabled = false; b.textContent = `Pay ${money(i.total_cents)} by card`; alertBox(e.message); }
  };
  function alertBox(m) { const p = document.createElement('p'); p.className = 'err'; p.textContent = m; b.after(p); }
}
load();
