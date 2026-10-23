// Account and sync UI: sign in / sign up / sign out, sync-now, and the status chip. Local-only is the default when signed out.
import { esc, toast, confirmDialog } from './ui.js';

const LABELS = {
  local: 'Local only',
  'signed-out': 'Local only',
  synced: 'Synced',
  syncing: 'Syncing',
  pending: 'Pending',
  offline: 'Offline',
  error: 'Error',
};

// Plain-language status line shown under the account card.
export function describeStatus(st) {
  const pending = st.pending || 0;
  const when = st.lastSyncAt ? `Last synced ${new Date(st.lastSyncAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })} (WAT).` : 'Not synced yet.';
  switch (st.state) {
    case 'local': return 'Cloud sync is not set up in this build. Your journal stays on this device.';
    case 'signed-out': return 'Signed out. Your journal stays on this device only. Sign in to back it up and sync across devices.';
    case 'syncing': return 'Syncing your journal now.';
    case 'offline': return `Offline. ${pending ? `${pending} change${pending === 1 ? '' : 's'} saved on this device and will sync when you are back online.` : 'Changes you make will sync when you are back online.'}`;
    case 'error': return `Sync failed: ${st.error || 'unknown error'} ${pending ? `${pending} change${pending === 1 ? '' : 's'} are kept and will retry.` : ''}`.trim();
    case 'pending': return `${pending} change${pending === 1 ? '' : 's'} waiting to sync. ${when}`;
    default: return `Everything is synced. ${when}`;
  }
}

// Small chip for the header and the settings card.
export function syncChipHTML(st) {
  const label = LABELS[st.state] || 'Local only';
  return `<span class="badge sync-chip sync-${esc(st.state)}" data-sync-chip="${esc(st.state)}" aria-label="Sync status: ${esc(label)}">${esc(label)}</span>`;
}

export function renderAccountCard(view, cloud, { onChange } = {}) {
  const st = cloud.status();
  const signedIn = cloud.signedIn();
  const body = signedIn
    ? `<p>Signed in as <strong>${esc(cloud.email)}</strong></p>
       <p class="small muted" id="acc-status">${esc(describeStatus(st))}</p>
       <div class="row">
         <button class="btn primary" id="acc-sync">Sync now</button>
         <button class="btn ghost" id="acc-out">Sign out</button>
       </div>
       <p class="small muted">Signing out keeps your trades on this device. Your cloud copy stays until you delete it.</p>`
    : `<p class="small muted" id="acc-status">${esc(describeStatus(st))}</p>
       <form id="acc-form" novalidate>
         <div class="field"><label for="acc-email">Email</label><input id="acc-email" type="email" autocomplete="email" inputmode="email" maxlength="254"/></div>
         <div class="field"><label for="acc-pass">Password (at least 6 characters)</label><input id="acc-pass" type="password" autocomplete="current-password" maxlength="128"/></div>
         <div class="row">
           <button class="btn primary" id="acc-in" type="submit">Sign in</button>
           <button class="btn" id="acc-up" type="button">Create account</button>
         </div>
       </form>`;
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'account-card';
  card.innerHTML = `<h3>Account and sync</h3><div class="row" style="margin-bottom:8px">${syncChipHTML(st)}</div>${body}`;
  const heading = view.querySelector('h1');
  if (heading) heading.after(card); else view.prepend(card);

  if (!cloud.configured) return card;

  if (signedIn) {
    card.querySelector('#acc-sync').addEventListener('click', async () => {
      const r = await cloud.syncNow();
      toast(r.ok ? 'Synced' : (r.reason === 'offline' ? 'You are offline. Changes will sync later.' : (r.error || 'Sync did not finish. It will retry.')));
      onChange && onChange();
    });
    card.querySelector('#acc-out').addEventListener('click', async () => {
      const ok = await confirmDialog('Sign out?', 'Your trades stay on this device. Changes you made while signed in are already in the cloud or queued.', 'Sign out');
      if (!ok) return;
      await cloud.signOut();
      toast('Signed out. Your journal stays on this device.');
      onChange && onChange();
    });
    return card;
  }

  const emailEl = card.querySelector('#acc-email');
  const passEl = card.querySelector('#acc-pass');
  const readCreds = () => {
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Enter a valid email address.'); return null; }
    if (password.length < 6) { toast('Password must be at least 6 characters.'); return null; }
    return { email, password };
  };
  const run = async (fn, btn) => {
    const creds = readCreds();
    if (!creds) return;
    btn.disabled = true;
    try {
      const r = await fn(creds.email, creds.password);
      if (r.status === 'confirm') toast('Check your inbox to confirm your email, then sign in.', 4000);
      else toast('Signed in. Syncing your journal.');
      onChange && onChange();
    } catch (e) {
      toast(e.message || 'Sign-in did not work. Try again.', 4000);
    } finally { btn.disabled = false; }
  };
  card.querySelector('#acc-form').addEventListener('submit', (e) => { e.preventDefault(); run((em, pw) => cloud.signIn(em, pw), card.querySelector('#acc-in')); });
  card.querySelector('#acc-up').addEventListener('click', () => run((em, pw) => cloud.signUp(em, pw), card.querySelector('#acc-up')));
  return card;
}
