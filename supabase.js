// Supabase client for Zainul FX Journal: plain fetch against /auth/v1 and /rest/v1. No SDK.
// No popups or redirects, so it works inside Telegram's webview: sign-in is email and password over fetch.
// SECURITY: this module only ever holds the PUBLISHABLE (anon) key. It refuses secret / service_role keys.
// Row Level Security on the Supabase side limits every row to its owner (auth.uid() = user_id).

export const AUTH_STORAGE_KEY = 'zainul-fx-journal:auth';
const EXPIRY_SKEW_MS = 60 * 1000;

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return JSON.parse(atob(b64 + pad));
  } catch (_) {
    return null;
  }
}

// True for keys that must never reach a browser: sb_secret_* keys and JWTs with role service_role.
export function looksLikeSecretKey(key) {
  const k = String(key || '').trim();
  if (/^sb_secret_/i.test(k)) return true;
  const payload = decodeJwtPayload(k);
  return !!(payload && payload.role === 'service_role');
}

export function isSupabaseConfigured(cfg) {
  if (!cfg) return false;
  const url = String(cfg.url || '').trim();
  const key = String(cfg.key || '').trim();
  if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(url)) return false;
  if (key.length < 20) return false;
  if (looksLikeSecretKey(key)) return false;
  return true;
}

// Plain-language messages for auth failures. Never shows raw server payloads.
export function friendlyAuthError(status, body) {
  const text = String((body && (body.error_description || body.msg || body.message || body.error)) || '').toLowerCase();
  if (text.includes('invalid login')) return 'Email or password is not right.';
  if (text.includes('already registered') || text.includes('already been registered') || text.includes('already exists')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (text.includes('email not confirmed')) return 'Confirm your email first. Check your inbox for the link.';
  if (text.includes('password') && (text.includes('least') || text.includes('short'))) return 'Password is too short (at least 6 characters).';
  if (text.includes('invalid email') || text.includes('valid email')) return 'Enter a valid email address.';
  if (status === 429 || text.includes('rate limit') || text.includes('too many')) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === 0) return "Can't reach the server. Check your connection and try again.";
  return `Sign-in did not work (code ${status || 'unknown'}). Try again.`;
}

function authError(r) {
  const e = new Error(friendlyAuthError(r.status, r.data));
  e.status = r.status;
  e.code = 'auth';
  return e;
}

function restError(r, table) {
  const msg = String((r.data && (r.data.message || r.data.hint)) || '');
  if (r.status === 401 || r.status === 403) {
    const e = new Error('Your session has expired. Sign in again.');
    e.code = 'session';
    e.status = r.status;
    return e;
  }
  if (/column|does not exist/i.test(msg)) {
    const e = new Error('The cloud tables are missing a column. Run supabase-stage3.sql in the Supabase SQL editor, then sync again.');
    e.code = 'schema';
    return e;
  }
  const e = new Error(`Cloud ${table} request failed (code ${r.status}). It will retry.`);
  e.code = 'server';
  e.status = r.status;
  return e;
}

// url: https://<project>.supabase.co  key: publishable key.  storage: localStorage-like (optional).
export function createSupabase({ url, key, storage = null, fetch: fetchImpl, now = () => Date.now() }) {
  if (!isSupabaseConfigured({ url, key })) {
    throw new Error('Supabase is not configured with a valid project URL and publishable key.');
  }
  const base = String(url).trim().replace(/\/+$/, '');
  const apiKey = String(key).trim();
  const doFetch = fetchImpl || ((input, init) => globalThis.fetch(input, init));
  const listeners = new Set();
  let session = readSession();
  let refreshing = null;

  function readSession() {
    try {
      const text = storage && storage.getItem(AUTH_STORAGE_KEY);
      if (!text) return null;
      const s = JSON.parse(text);
      return s && s.access_token && s.refresh_token && s.user && s.user.id ? s : null;
    } catch (_) {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (storage) {
        if (next) storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
        else storage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (_) { /* storage blocked: session lives in memory for this visit */ }
    for (const fn of [...listeners]) { try { fn(session); } catch (_) { /* ignore listener errors */ } }
  }

  function fromTokenBody(b) {
    const expiresAt = b.expires_at ? Number(b.expires_at) * 1000 : now() + (Number(b.expires_in) || 3600) * 1000;
    return {
      access_token: b.access_token,
      refresh_token: b.refresh_token,
      expires_at: expiresAt,
      user: { id: b.user.id, email: b.user.email || '' },
    };
  }

  async function call(path, { method = 'GET', body, headers = {}, token } = {}) {
    const init = {
      method,
      headers: { apikey: apiKey, Authorization: `Bearer ${token || apiKey}`, ...headers },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await doFetch(base + path, init);
    } catch (_) {
      const e = new Error("Can't reach the server. Check your connection and try again.");
      e.code = 'network';
      throw e;
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, data };
  }

  // Single-flight refresh. A 400/401/403 from the token endpoint means the refresh token is dead: sign out locally.
  // A network failure keeps the session so the app can retry when it is back online.
  function refreshSession() {
    if (!session || !session.refresh_token) return Promise.resolve(false);
    if (!refreshing) {
      const rt = session.refresh_token;
      refreshing = call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } })
        .then((r) => {
          if (r.ok && r.data && r.data.access_token) { writeSession(fromTokenBody(r.data)); return true; }
          if (r.status === 400 || r.status === 401 || r.status === 403) writeSession(null);
          return false;
        })
        .catch(() => false)
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function currentToken() {
    if (session && session.expires_at - EXPIRY_SKEW_MS <= now()) await refreshSession();
    return session ? session.access_token : null;
  }

  // Authenticated request. On 401 it refreshes once and retries.
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    let r = await call(path, { method, body, headers, token: await currentToken() });
    if (r.status === 401 && session) {
      const ok = await refreshSession();
      if (ok) r = await call(path, { method, body, headers, token: session.access_token });
    }
    return r;
  }

  async function signUp(email, password) {
    const r = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (!r.ok) throw authError(r);
    if (r.data && r.data.access_token && r.data.user) {
      writeSession(fromTokenBody(r.data));
      return { status: 'signed-in', email: session.user.email };
    }
    // Email confirmation is enabled on the project: no session yet.
    return { status: 'confirm', email };
  }

  async function signIn(email, password) {
    const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (!r.ok || !r.data || !r.data.access_token) throw authError(r);
    writeSession(fromTokenBody(r.data));
    return { status: 'signed-in', email: session.user.email };
  }

  async function signOut() {
    const token = session && session.access_token;
    writeSession(null); // clear locally first: the device is signed out even if the network call fails
    if (token) { try { await call('/auth/v1/logout', { method: 'POST', token }); } catch (_) { /* ignore */ } }
    return { status: 'signed-out' };
  }

  async function select(table, query) {
    const r = await request(`/rest/v1/${table}?${query}`);
    if (!r.ok) throw restError(r, table);
    return Array.isArray(r.data) ? r.data : [];
  }

  // Reads every row the signed-in user can see, page by page (PostgREST caps a single response).
  async function selectAll(table, columns = '*', pageSize = 1000) {
    const out = [];
    for (let offset = 0; ; offset += pageSize) {
      const r = await request(`/rest/v1/${table}?select=${encodeURIComponent(columns)}&order=created_at.asc,id.asc&limit=${pageSize}&offset=${offset}`);
      if (!r.ok) throw restError(r, table);
      const page = Array.isArray(r.data) ? r.data : [];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  async function upsert(table, rows, onConflict) {
    const r = await request(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      body: rows,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!r.ok) throw restError(r, table);
  }

  async function remove(table, query) {
    const r = await request(`/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!r.ok) throw restError(r, table);
  }

  return {
    getSession: () => session,
    onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    signUp,
    signIn,
    signOut,
    select,
    selectAll,
    upsert,
    remove,
    request,
    refreshSession,
  };
}
