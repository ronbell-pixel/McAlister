// Shared helpers: API calls, formatting, icons, sheets, toasts.

export async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && url !== '/login' && url !== '/me/password') {
    location.hash = '#/login';
    location.reload();
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const money = (c) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const moneyShort = (c) => {
  const d = (c || 0) / 100;
  if (d >= 10000) return '$' + (d / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k';
  return '$' + d.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
export const dollars = (c) => (c == null ? '' : (c / 100).toFixed(2));
export function date(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function when(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + (s.length > 10 && !s.endsWith('Z') ? 'Z' : ''));
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || c.customer_name || 'Unnamed';
export const initials = (c) => (fullName(c).split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  home: P('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.5 4.6 4"/>'),
  invoice: P('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>'),
  alert: P('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  grid: P('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  chevron: P('<path d="M9 6l6 6-6 6"/>'),
  back: P('<path d="M15 6l-6 6 6 6"/>'),
  x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  phone: P('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>'),
  mail: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  chat: P('<path d="M4 5h16v11H9l-5 4z"/>'),
  camera: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  printer: P('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  send: P('<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'),
  check: P('<path d="M5 12l5 5L20 7"/>'),
  play: P('<path d="M7 4l13 8-13 8z"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>'),
  download: P('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  logout: P('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  boat: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="M12 4l6 8h-6"/><path d="M3 15h18l-2.5 4h-13z"/><path d="M2 21c1.5 0 2-1 3.5-1S7.5 21 9 21s2-1 3.5-1 2 1 3.5 1 2-1 3.5-1"/></svg>',
};

let toastTimer;
export function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2600);
}
export const fail = (e) => toast(e.message || String(e), 'error');

// Bottom sheet on phones, centered dialog on larger screens.
// Returns { el, body, close }. `buttons` = [{ label, kind, onClick(close) }]
export function sheet({ title, body = '', buttons = [], wide = false, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="btn ghost sm" data-x aria-label="Close">${icon.x}</button></div>
    <div class="sheet-body"></div>
    ${buttons.length ? '<div class="sheet-foot"></div>' : ''}
  </div>`;
  const bodyEl = ov.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-x]').onclick = close;
  const foot = ov.querySelector('.sheet-foot');
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.kind || '');
    btn.innerHTML = b.label;
    btn.onclick = async () => {
      btn.disabled = true;
      try { await b.onClick(close, btn); } catch (e) { fail(e); } finally { btn.disabled = false; }
    };
    foot.appendChild(btn);
  }
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const first = bodyEl.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
  if (first && window.matchMedia('(min-width: 700px)').matches) setTimeout(() => first.focus(), 50);
  return { el: ov, body: bodyEl, close };
}

export function confirmSheet(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title,
      body: `<p style="margin:0">${esc(message)}</p>`,
      buttons: [
        { label: 'Cancel', onClick: (close) => { done = true; resolve(false); close(); } },
        { label: esc(okLabel), kind: danger ? 'primary danger-bg' : 'primary', onClick: (close) => { done = true; resolve(true); close(); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return s;
  });
}

// Builds form fields. defs: [{ name, label, type, options, placeholder, hint, full, step, rows }]
export function fields(defs, values = {}) {
  return defs.map((d) => {
    if (d.html) return d.html;
    const v = values[d.name] ?? d.value ?? '';
    const common = `name="${d.name}" ${d.required ? 'required' : ''} ${d.placeholder ? `placeholder="${esc(d.placeholder)}"` : ''}`;
    let input;
    if (d.type === 'select') {
      input = `<select ${common}>${d.options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select>`;
    } else if (d.type === 'textarea') {
      input = `<textarea ${common} rows="${d.rows || 3}">${esc(v)}</textarea>`;
    } else if (d.type === 'checkbox') {
      return `<label class="check"><input type="checkbox" name="${d.name}" ${v === true || v === 'true' || v === 1 ? 'checked' : ''}> <span>${esc(d.label)}</span></label>`;
    } else {
      const extra = d.type === 'money' ? 'inputmode="decimal"' : d.type === 'tel' ? 'inputmode="tel"' : d.type === 'number' ? `inputmode="decimal" step="${d.step || 'any'}"` : '';
      const t = d.type === 'money' ? 'text' : (d.type || 'text');
      input = `<input type="${t}" ${common} ${extra} value="${esc(v)}" ${d.autocomplete ? `autocomplete="${d.autocomplete}"` : ''}>`;
    }
    return `<label class="field" ${d.full ? 'style="grid-column:1/-1"' : ''}><span>${esc(d.label)}</span>${input}${d.hint ? `<small>${esc(d.hint)}</small>` : ''}</label>`;
  }).join('');
}

export function formData(root) {
  const out = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  });
  return out;
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function statusBadge(inv) {
  if (inv.status === 'sent' && (inv.overdue || inv.due_date < today())) return '<span class="badge bad">Overdue</span>';
  return {
    draft: '<span class="badge">Draft</span>',
    sent: '<span class="badge warn">Open</span>',
    paid: '<span class="badge good">Paid</span>',
    void: '<span class="badge">Void</span>',
  }[inv.status] || '';
}
