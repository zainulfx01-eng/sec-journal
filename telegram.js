// Telegram Mini App shell. Uses window.Telegram.WebApp when present; falls back to demo/local mode in a plain browser.
// SECURITY: this file never trusts user IDs from the client. initData is read only for display/context.
// Stage 3 must validate initData server-side (HMAC-SHA256 with the bot token, check `hash`, check `auth_date` freshness).

export function getTelegram() {
  return typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

export function isInsideTelegram() {
  const tg = getTelegram();
  return !!(tg && tg.initData);
}

export function initShell(handlers = {}) {
  const tg = getTelegram();
  const info = { mode: 'browser', platform: 'web', initDataOk: false, user: null };
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (_) { /* older clients */ }
    info.mode = tg.initData ? 'telegram' : 'telegram-no-data';
    info.platform = tg.platform || 'unknown';
    // initData is parsed for display only. It is NOT trusted for identity in Stage 1.
    try {
      const params = new URLSearchParams(tg.initData || '');
      const u = params.get('user');
      if (u) { const parsed = JSON.parse(u); info.user = { firstName: String(parsed.first_name || '').slice(0, 64) }; }
    } catch (_) { info.user = null; }
    applyTelegramTheme(tg);
    try { tg.onEvent && tg.onEvent('themeChanged', () => applyTelegramTheme(tg)); } catch (_) {}
    try { tg.BackButton.onClick(() => handlers.onBack && handlers.onBack()); } catch (_) {}
  }
  // Viewport: keep the bottom nav above the on-screen keyboard in the WebView.
  if (window.visualViewport) {
    const set = () => document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
    window.visualViewport.addEventListener('resize', set);
    set();
  }
  return info;
}

// Telegram theme params override our palette only if the user has not picked a theme in Settings.
function applyTelegramTheme(tg) {
  const p = tg.themeParams || {};
  const root = document.documentElement;
  if (p.bg_color) root.style.setProperty('--tg-bg', p.bg_color);
  if (tg.colorScheme === 'light' && !root.dataset.userTheme) root.dataset.theme = 'light';
  if (tg.colorScheme === 'dark' && !root.dataset.userTheme) root.dataset.theme = 'dark';
}

// Main/back button helpers. Safe no-ops outside Telegram.
export function setBackButton(visible, onClick) {
  const tg = getTelegram();
  if (!tg || !tg.BackButton) return;
  try { if (visible) tg.BackButton.show(); else tg.BackButton.hide(); } catch (_) {}
  void onClick;
}

export function setMainButton(text, onClick, visible = true) {
  const tg = getTelegram();
  if (!tg || !tg.MainButton) return;
  try {
    tg.MainButton.offClick && tg.MainButton.offClick(onClick);
    if (!visible) { tg.MainButton.hide(); return; }
    tg.MainButton.setText(text);
    tg.MainButton.onClick(onClick);
    tg.MainButton.show();
  } catch (_) {}
}

export function haptic(kind = 'light') {
  const tg = getTelegram();
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind); } catch (_) {}
}
