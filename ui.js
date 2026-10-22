// DOM helpers. Everything user-supplied goes through esc() before it touches innerHTML.
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function money(n, currency = 'USD', { sign = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = v > 0 && sign ? '+' : v < 0 ? '−' : '';
  return `${prefix}${currency ? currency + ' ' : ''}${abs}`;
}

export function plClass(n) {
  if (n == null || Number.isNaN(n)) return 'flat';
  const eps = 0.005;
  if (n > eps) return 'pos';
  if (n < -eps) return 'neg';
  return 'flat';
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) + ' WAT';
}

// Local input value (datetime-local) from a stored UTC ISO string, interpreted in Africa/Lagos.
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

// datetime-local value (interpreted as Africa/Lagos, UTC+1, no DST) to canonical UTC ISO.
export function localInputToIso(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  return new Date(s + ':00+01:00').toISOString();
}

export function toast(msg, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function showNotice(msg, kind = '') {
  const n = $('#notice');
  if (!msg) { n.classList.add('hidden'); n.textContent = ''; return; }
  n.className = 'notice ' + kind;
  n.textContent = msg;
}

// Modal with a promise-based confirm. Returns the DOM element for content injection.
export function openModal({ title, body, actions = [], onClose } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-close="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
    <div class="modal-head"><h2 style="flex:1">${esc(title || '')}</h2><button class="icon-btn" data-close="1" aria-label="Close">✕</button></div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div></div></div>`;
  const bodyEl = $('.modal-body', root);
  const footEl = $('.modal-foot', root);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.kind || '');
    b.textContent = a.label;
    b.addEventListener('click', () => a.onClick && a.onClick(close));
    footEl.appendChild(b);
  }
  function close() { root.innerHTML = ''; onClose && onClose(); }
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.dataset.close) close(); });
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', (e) => { if (e.currentTarget.dataset.close && e.target === e.currentTarget) close(); }));
  return { close, bodyEl, footEl };
}

export function confirmDialog(title, text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (!done) { done = true; close(); resolve(v); } };
    openModal({
      title,
      body: `<p class="muted">${esc(text)}</p>`,
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: (c) => finish(false, c) },
        { label: okLabel, kind: 'danger', onClick: (c) => finish(true, c) },
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
