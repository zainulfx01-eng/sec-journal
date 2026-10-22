// App entry: boots storage, Telegram shell, router and bottom navigation.
import { initShell, getTelegram, setBackButton, haptic } from './telegram.js';
import { createStore } from './storage.js';
import { APP_NAME } from './config.js';
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

export const ctx = { store: null, tab: 'dashboard', route: {} };

function go(tab, route = {}) {
  ctx.tab = tab in TABS ? tab : 'dashboard';
  ctx.route = route;
  $$('.nav-btn').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ctx.tab ? 'page' : 'false'));
  setBackButton(false);
  render();
  window.scrollTo(0, 0);
}

export function render() {
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
  badge.textContent = info.mode === 'telegram' ? 'Telegram' : 'Browser demo';
  if (info.mode !== 'telegram') {
    showNotice('Opened in a plain browser. Data is stored only on this device, not synced to Telegram.', 'warn');
  }

  let storage;
  try { storage = window.localStorage; } catch (_) { storage = null; }
  if (!storage) {
    showNotice('Browser storage is blocked, so trades cannot be saved on this device.', 'error');
    $('#view').innerHTML = '<div class="empty"><h2>Storage unavailable</h2><p>Enable site storage in your browser or Telegram settings, then reload.</p></div>';
    return;
  }
  ctx.store = createStore(storage);
  const r = ctx.store.load();
  if (!r.ok) showNotice(r.error, 'error');

  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => { haptic('light'); go(b.dataset.tab); }));
  $('#fab').addEventListener('click', () => openTradeForm(null, ctx));
  document.title = APP_NAME;
  go(ctx.tab);

  const tg = getTelegram();
  try { tg && tg.setHeaderColor && tg.setHeaderColor('#0E0E10'); tg && tg.setBackgroundColor && tg.setBackgroundColor('#0E0E10'); } catch (_) {}
}

boot();
export { toast };
