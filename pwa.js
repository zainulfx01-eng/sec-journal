// PWA glue: registers the service worker and shows a small toast when a new version activates.
// The service worker never touches Supabase or non-GET requests (see service-worker.js). Where service workers are
// unavailable, registration is a no-op and the app behaves exactly as before.

export const SW_PATH = './service-worker.js';

// Pure decision used by the toast: only tell the user about an update when an older worker was already in control.
// The very first install (no controller yet) means the app is simply ready for offline use, so no toast.
export function shouldShowUpdateToast({ hadController, activated }) {
  return Boolean(hadController && activated);
}

export function registerServiceWorker({ nav = typeof navigator !== 'undefined' ? navigator : null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (!nav || !('serviceWorker' in nav) || !doc) return Promise.resolve(null);
  const hadController = Boolean(nav.serviceWorker.controller);
  let notified = false;
  const notify = () => {
    if (notified || !shouldShowUpdateToast({ hadController, activated: true })) return;
    notified = true;
    showUpdateToast(doc);
  };
  nav.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'SW_ACTIVATED') notify(); });
  nav.serviceWorker.addEventListener('controllerchange', notify);
  return nav.serviceWorker.register(SW_PATH, { scope: './' }).catch((err) => {
    console.warn('Service worker not registered:', err && err.message);
    return null;
  });
}

export function showUpdateToast(doc = document) {
  if (doc.getElementById('update-toast')) return;
  const el = doc.createElement('div');
  el.id = 'update-toast';
  el.className = 'update-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>A new version is ready.</span><button class="btn small primary" id="update-reload">Reload</button>';
  doc.body.appendChild(el);
  el.querySelector('#update-reload').addEventListener('click', () => doc.defaultView.location.reload());
}
