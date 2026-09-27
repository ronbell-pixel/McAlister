// App shell: session, sign-in, navigation and routing.
import { get, post, esc, icon, fail, fields, formData } from './ui.js';

export const state = { session: null, location: '' };

// Location filter (only shown when there is more than one location).
function loadLocation() {
  let v = '';
  try { v = localStorage.getItem('location') || ''; } catch { /* private mode */ }
  const locs = state.session?.locations || [];
  state.location = locs.length > 1 && locs.some((l) => String(l.id) === v) ? v : '';
}
export const multiLocation = () => (state.session?.locations || []).length > 1;
// Adds ?location= to an API url when a location is picked.
export function withLoc(url) {
  if (!state.location) return url;
  return url + (url.includes('?') ? '&' : '?') + 'location=' + encodeURIComponent(state.location);
}
export const locationName = () => (state.session?.locations || []).find((l) => String(l.id) === state.location)?.name || '';
export const can = (perm) => Boolean(state.session?.user?.permissions?.includes(perm));

const app = document.getElementById('app');

function applyBrand(company) {
  const c = /^#[0-9a-f]{6}$/i.test(company.brandColor || '') ? company.brandColor : '#0b5c8a';
  document.documentElement.style.setProperty('--brand', c);
  document.querySelector('meta[name=theme-color]').setAttribute('content', c);
  document.title = company.name || 'Storage';
  document.querySelector('meta[name=apple-mobile-web-app-title]').setAttribute('content', company.name || 'Storage');
}

async function loadSession() {
  state.session = await get('/session');
  applyBrand(state.session.company);
  loadLocation();
}

// ---------- Sign in / first admin ----------
function authPage(inner) {
  app.innerHTML = `<div class="auth"><div class="card">
    <div class="brandmark">${icon.boat}</div>
    ${inner}
  </div></div>`;
}

function renderLogin() {
  const c = state.session.company;
  authPage(`<h1>${esc(c.name)}</h1><p class="muted">Sign in to continue</p>
    <form id="f">
      ${fields([
        { name: 'email', label: 'Email', type: 'email', autocomplete: 'username', required: true },
        { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', required: true },
      ])}
      <div class="err" id="err"></div>
      <button class="btn primary block" type="submit">Sign in</button>
    </form>`);
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try { await post('/login', formData(f)); await start('#/'); }
    catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
  };
}

function renderFirstAdmin() {
  const c = state.session.company;
  authPage(`<h1>Welcome to ${esc(c.name)}</h1><p class="muted">Create the admin account. You can add owners and staff after.</p>
    <form id="f">
      ${fields([
        { name: 'name', label: 'Your name', required: true, autocomplete: 'name' },
        { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'username' },
        { name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters' },
      ])}
      <div class="err" id="err"></div>
      <button class="btn primary block" type="submit">Create admin account</button>
    </form>`);
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await post('/first-admin', formData(f)); await start('#/setup'); }
    catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

// ---------- Shell ----------
function navItems() {
  const items = [
    { href: '#/', key: 'home', label: 'Dashboard', ic: icon.home },
    { href: '#/customers', key: 'customers', label: 'Customers', ic: icon.users },
    { href: '#/spots', key: 'spots', label: 'Spots', ic: icon.grid },
    { href: '#/waitlist', key: 'waitlist', label: 'Waitlist', ic: icon.clock },
  ];
  if (can('invoices')) items.push({ href: '#/invoices', key: 'invoices', label: 'Invoices', ic: icon.invoice });
  if (can('letters')) items.push({ href: '#/letters', key: 'letters', label: 'Letters', ic: icon.mail });
  items.push({ href: '#/log', key: 'log', label: 'Incident log', short: 'Log', ic: icon.alert });
  if (can('setup')) items.push({ href: '#/setup', key: 'setup', label: 'Setup', ic: icon.gear });
  return items;
}

function renderShell() {
  const u = state.session.user;
  const c = state.session.company;
  const nav = navItems();
  // Phone tab bar: 4 main + More
  const tabs = nav.filter((n) => ['home', 'customers', 'invoices', 'log'].includes(n.key));
  if (tabs.length < 4) tabs.splice(2, 0, nav.find((n) => n.key === 'spots'));
  const picker = multiLocation() ? `<select class="loc-picker" aria-label="Location">
      <option value="">All locations</option>${state.session.locations.map((l) => `<option value="${l.id}" ${String(l.id) === state.location ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
    </select>` : '';
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brandmark">${icon.boat}</div><div><b>${esc(c.name)}</b><small>${esc(c.tagline || '')}</small></div></div>
      ${picker ? `<div style="padding:0 4px 14px">${picker}</div>` : ''}
      ${nav.map((n) => `<a class="nav" data-key="${n.key}" href="${n.href}">${n.ic}<span>${n.label}</span></a>`).join('')}
      <div class="spacer"></div>
      <a class="nav" data-key="account" href="#/account">${icon.users}<span>My account</span></a>
      <div class="who"><b>${esc(u.name)}</b>${esc(roleName(u.role))}</div>
    </aside>
    <div>
      <header class="topbar"><div class="brandmark">${icon.boat}</div><div class="brandname">${esc(c.name)}</div>${picker}</header>
      <main id="main"></main>
    </div>
    <nav class="tabbar">
      ${tabs.slice(0, 4).map((n) => `<a data-key="${n.key}" href="${n.href}">${n.ic}<span>${n.short || n.label}</span></a>`).join('')}
      <a data-key="more" href="#/more">${icon.more}<span>More</span></a>
    </nav>
  </div>`;
}

function wirePicker() {
  document.querySelectorAll('.loc-picker').forEach((sel) => {
    sel.onchange = () => {
      state.location = sel.value;
      try { localStorage.setItem('location', sel.value); } catch { /* ignore */ }
      document.querySelectorAll('.loc-picker').forEach((o) => { o.value = sel.value; });
      route();
    };
  });
}

export const roleName = (r) => ({ admin: 'Admin', owner: 'Owner', user: 'Staff' }[r] || r);

function setActive(key) {
  document.querySelectorAll('[data-key]').forEach((a) => a.classList.toggle('active', a.dataset.key === key));
}

// ---------- Router ----------
const routes = [
  [/^#?\/?$/, 'home', () => import('./views/dashboard.js').then((m) => m.dashboard())],
  [/^#\/customers\/(\d+)$/, 'customers', (id) => import('./views/customers.js').then((m) => m.customerDetail(Number(id)))],
  [/^#\/customers$/, 'customers', () => import('./views/customers.js').then((m) => m.customerList())],
  [/^#\/spots$/, 'spots', () => import('./views/spots.js').then((m) => m.spotsBoard())],
  [/^#\/letters$/, 'letters', () => import('./views/letters.js').then((m) => m.lettersPage())],
  [/^#\/waitlist$/, 'waitlist', () => import('./views/waitlist.js').then((m) => m.waitlistPage())],
  [/^#\/invoices$/, 'invoices', () => import('./views/invoices.js').then((m) => m.invoiceList())],
  [/^#\/log\/(\d+)$/, 'log', (id) => import('./views/incidents.js').then((m) => m.incidentDetail(Number(id)))],
  [/^#\/log$/, 'log', () => import('./views/incidents.js').then((m) => m.incidentList())],
  [/^#\/setup(?:\/(\w+))?$/, 'setup', (tab) => import('./views/setup.js').then((m) => m.setup(tab))],
  [/^#\/account$/, 'account', () => import('./views/account.js').then((m) => m.account())],
  [/^#\/more$/, 'more', () => renderMore()],
];

function renderMore() {
  const main = document.getElementById('main');
  const extra = navItems().filter((n) => !document.querySelector(`.tabbar a[data-key="${n.key}"]`));
  main.innerHTML = `<div class="page-head"><h1>More</h1></div>
    <div class="card"><ul class="list">
      ${[...extra, { href: '#/account', label: 'My account', ic: icon.users }].map((n) =>
        `<li><a class="item" href="${n.href}"><span style="width:24px;color:var(--brand)">${n.ic}</span><div class="main"><div class="title">${n.label}</div></div>${icon.chevron.replace('<svg', '<svg class="chev"')}</a></li>`).join('')}
      <li><a class="item" href="#" id="signout"><span style="width:24px;color:var(--bad)">${icon.logout}</span><div class="main"><div class="title">Sign out</div></div></a></li>
    </ul></div>`;
  document.getElementById('signout').onclick = async (e) => { e.preventDefault(); await signOut(); };
}

export async function signOut() {
  await post('/logout');
  location.hash = '#/';
  await start();
}

let routing = 0;
export async function route() {
  if (!state.session?.user) return;
  const [hash, qs] = (location.hash || '#/').split('?');
  state.query = new URLSearchParams(qs || '');
  const n = ++routing;
  for (const [re, key, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      const need = { invoices: 'invoices', setup: 'setup', letters: 'letters' }[key];
      if (need && !can(need)) { location.hash = '#/'; return; }
      setActive(key);
      window.scrollTo(0, 0);
      try { await fn(...m.slice(1)); } catch (e) { if (n === routing) fail(e); }
      return;
    }
  }
  location.hash = '#/';
}

export function main() { return document.getElementById('main'); }

// Removes ?action from the address after a view has handled it (so Back doesn't re-trigger it).
export function clearQuery() {
  const [h] = location.hash.split('?');
  history.replaceState(null, '', location.pathname + h);
}

async function start(to) {
  await loadSession();
  const s = state.session;
  if (s.needsFirstAdmin) return renderFirstAdmin();
  if (!s.user) return renderLogin();
  renderShell();
  wirePicker();
  if (to && location.hash !== to) location.hash = to; else route();
}

window.addEventListener('hashchange', route);
start().catch((e) => { app.innerHTML = `<div class="auth"><div class="card"><h2>Can't reach the server</h2><p class="muted">${esc(e.message)}</p></div></div>`; });
