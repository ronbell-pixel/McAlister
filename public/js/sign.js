// Public signing page: read the agreement, type your name, sign with a finger or mouse.
const app = document.getElementById('app');
const token = location.pathname.split('/').pop();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const boat = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M12 4l6 8h-6"/><path d="M3 15h18l-2.5 4h-13z"/><path d="M2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1"/></svg>';

function header(company) {
  return `<div class="top"><div class="brandmark">${boat}</div><div><b>${esc(company.name)}</b></div></div>`;
}

function doneView(d, justNow) {
  app.innerHTML = `${header(d.company)}<div class="card done">
    <div class="ok">${check}</div>
    <h1 style="font-size:22px">${justNow ? 'Thank you — you’re all signed' : 'This agreement is signed'}</h1>
    <p class="muted">${esc(d.signer_name || '')}${d.signed_at ? ` · ${new Date(d.signed_at.replace(' ', 'T') + 'Z').toLocaleString()}` : ''}</p>
    <p class="muted small">${justNow ? 'A copy has been saved with ' + esc(d.company.name) + '. If you gave us your email, a copy is on its way.' : ''}</p>
  </div>`;
}

async function load() {
  let d;
  try {
    const res = await fetch(`/api/public/agreements/${encodeURIComponent(token)}`);
    d = await res.json();
    if (!res.ok) throw new Error(d.error || 'This link is not valid.');
  } catch (e) {
    app.innerHTML = `<div class="card done"><h1 style="font-size:20px">Link not available</h1><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (/^#[0-9a-f]{6}$/i.test(d.company.brandColor || '')) document.documentElement.style.setProperty('--brand', d.company.brandColor);
  document.title = `${d.title} — ${d.company.name}`;
  if (d.status === 'signed') return doneView(d, false);

  app.innerHTML = `${header(d.company)}
    <h1 style="font-size:24px;margin-bottom:6px">${esc(d.title)}</h1>
    <p class="muted" style="margin-top:0">Please read the agreement, then sign at the bottom.</p>
    <div class="card doc">${esc(d.body)}</div>
    <div class="step">Your signature</div>
    <div class="card pad">
      <label class="field"><span>Type your full name</span><input id="name" autocomplete="name" value="${esc(d.suggestedName || '')}"></label>
      <label class="field" style="margin-bottom:6px"><span>Sign in the box with your finger or mouse</span></label>
      <div class="pad-wrap"><canvas id="pad" aria-label="Signature area"></canvas>
        <div class="pad-hint"><span>Sign above this line</span></div>
        <button type="button" class="btn sm clear" id="clear">Clear</button></div>
      <label class="check" style="margin-top:14px;align-items:flex-start"><input type="checkbox" id="agree" style="margin-top:2px">
        <span>I have read and agree to this agreement, and I agree to sign it electronically.</span></label>
      <div class="err" id="err" style="margin-top:8px"></div>
      <button class="btn primary block" id="submit" style="margin-top:6px;min-height:52px;font-size:17px">Sign agreement</button>
      ${d.company.phone ? `<p class="muted small" style="text-align:center;margin-bottom:0">Questions? Call ${esc(d.company.phone)}</p>` : ''}
    </div>`;

  // Signature pad (sharp on high-resolution screens).
  const canvas = document.getElementById('pad');
  const ctx = canvas.getContext('2d');
  let drawn = false, drawing = false, last = null;
  const size = () => {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const img = drawn ? canvas.toDataURL() : null;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10202e';
    if (img) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, r.width, r.height); i.src = img; }
  };
  size();
  window.addEventListener('resize', size);
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pt(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#10202e'; ctx.fill(); drawn = true; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; drawn = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  document.getElementById('clear').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; };

  document.getElementById('submit').onclick = async (e) => {
    const err = document.getElementById('err');
    err.textContent = '';
    const name = document.getElementById('name').value.trim();
    if (name.length < 2) { err.textContent = 'Please type your full name.'; return; }
    if (!drawn) { err.textContent = 'Please sign in the box.'; return; }
    if (!document.getElementById('agree').checked) { err.textContent = 'Please check the box to agree.'; return; }
    // Crop to a white-background PNG for the record.
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0);
    e.target.disabled = true; e.target.textContent = 'Signing…';
    try {
      const res = await fetch(`/api/public/agreements/${encodeURIComponent(token)}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, agree: true, signature: out.toDataURL('image/png') }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Could not sign. Please try again.');
      window.scrollTo(0, 0);
      doneView({ ...d, signer_name: name, signed_at: r.signed_at }, true);
    } catch (ex) {
      err.textContent = ex.message; e.target.disabled = false; e.target.textContent = 'Sign agreement';
    }
  };
}
load();
