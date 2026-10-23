// App entry: boots storage, Telegram shell, router and bottom navigation.
import { initShell, getTelegram, setBackButton, haptic } from './telegram.js';
import { createStore } from './storage.js';
import { APP_NAME, STORAGE_KEY } from './config.js';
import { createCloud } from './cloud.js';
import { $, $$, showNotice, toast } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderJournal, openTradeForm } from './journal.js';
import { renderAnalytics } from './analytics.js';
import { renderCalculator } from './calculator.js';
import { renderSettings } from './settings.js';

const TABS = {
  dashboard: renderDashboard,
  journal: renderJournal,
  analytics: renderAnalytics,
  calculator: renderCalculator,
  settings: renderSettings,
};

export const ctx = { store: null, tab: 'dashboard', route: {}, rerender: null };

function go(tab, route = {}) {
  ctx.tab = tab in TABS ? tab : 'dashboard';
  ctx.route = route;
  $$('.nav-btn').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ctx.tab ? 'page' : 'false'));
  setBackButton(false);
  render();
  window.scrollTo(0, 0);
}

export function render() {
  ctx.rerender = render;
  const view = $('#view');
  try {
    TABS[ctx.tab](view, ctx);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>Something went wrong on this screen.</h2><p class="muted small">${String(e && e.message || e).replace(/[<>]/g, '')}</p><button class="btn" id="retry">Reload view</button></div>`;
    $('#retry').addEventListener('click', render);
  }
}

// Expose navigation for views (dashboard quick-add, etc.)
export function navigate(tab, route) { go(tab, route); }

function boot() {
  const info = initShell({ onBack: () => go(ctx.tab) });
  const badge = $('#mode-badge');
  if (info.mode !== 'telegram') {
    showNotice('Opened in a plain browser. Your journal is saved on this device. Sign in under Settings to sync it.', 'warn');
  }

  let storage;
  try { storage = window.localStorage; } catch (_) { storage = null; }
  if (!storage) {
    showNotice('Browser storage is blocked, so trades cannot be saved on this device.', 'error');
    $('#view').innerHTML = '<div class="empty"><h2>Storage unavailable</h2><p>Enable site storage in your browser or Telegram settings, then reload.</p></div>';
    return;
  }
  // Stage 3: cloud is created before the store so its hooks can be passed in. Signed out = local-only (no queueing).
  ctx.cloud = createCloud({ storage });
  ctx.store = createStore(storage, STORAGE_KEY, ctx.cloud.hooks);
  ctx.rerender = render;
  const r = ctx.store.load();
  if (!r.ok) showNotice(r.error, 'error');
  ctx.cloud.attach(ctx.store, { onRemoteChange: () => { if (ctx.tab) render(); } });
  ctx.cloud.onStatus(paintSyncChip);
  paintSyncChip(ctx.cloud.status());
  window.addEventListener('online', () => ctx.cloud.kick());

  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => { haptic('light'); go(b.dataset.tab); }));
  $('#fab').addEventListener('click', () => openTradeForm(null, ctx));
  document.title = APP_NAME;
  go(ctx.tab);

  const tg = getTelegram();
  try { tg && tg.setHeaderColor && tg.setHeaderColor('#0E0E10'); tg && tg.setBackgroundColor && tg.setBackgroundColor('#0E0E10'); } catch (_) {}
}

// Header chip: Local only / Synced / Syncing / Offline / Error.
function paintSyncChip(st) {
  const el = document.querySelector('#mode-badge');
  if (!el || !ctx.cloud) return;
  const label = { local: 'Local only', 'signed-out': 'Local only', synced: 'Synced', syncing: 'Syncing', pending: 'Pending', offline: 'Offline', error: 'Error' }[st.state] || 'Local only';
  el.textContent = label;
  el.dataset.syncState = st.state;
}

boot();
export { toast };
