import { post, esc, icon, toast, fail, fields, formData } from '../ui.js';
import { main, state, roleName, signOut } from '../app.js';

export async function account() {
  const u = state.session.user;
  main().innerHTML = `<div class="page-head"><h1>My account</h1></div>
    <div class="stack" style="max-width:560px">
      <div class="card pad"><div class="profile"><div class="avatar">${esc(u.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</div>
        <div><b>${esc(u.name)}</b><div class="muted small">${esc(u.email)} · ${roleName(u.role)}</div></div></div></div>
      <div class="card pad"><h3 style="margin-bottom:12px">Change password</h3>
        <form>${fields([
          { name: 'current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
          { name: 'next', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters' },
        ])}<button class="btn primary" type="submit">Update password</button></form></div>
      <div class="card pad"><h3 style="margin-bottom:6px">Add to your iPhone home screen</h3>
        <p class="muted small" style="margin:0">In Safari, tap the Share button, then <b>Add to Home Screen</b>. The app opens full-screen like a regular app.</p></div>
      <button class="btn danger" id="out">${icon.logout} Sign out</button>
    </div>`;
  const f = main().querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await post('/me/password', formData(f)); f.reset(); toast('Password updated'); } catch (err) { fail(err); }
  };
  document.getElementById('out').onclick = () => signOut().catch(fail);
}
