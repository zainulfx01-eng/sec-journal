// Cloud wiring for Zainul FX Journal (Stage 3). Ties config, the Supabase client, the persisted sync queue and the sync engine together.
// Signed out, or when Supabase is not configured, every method degrades to local-only: nothing is queued and nothing is sent.
import { SUPABASE_CONFIG } from './config.js';
import { createSupabase, isSupabaseConfigured } from './supabase.js';
import { createSyncQueue, createSyncEngine, SYNC_QUEUE_KEY } from './sync.js';

const defaultOnline = () => (typeof navigator === 'undefined' || navigator.onLine !== false);

// storage: localStorage-like. fetchImpl / now / online / debounceMs / retryMs: injectable for tests.
export function createCloud({ storage = null, config = SUPABASE_CONFIG, fetchImpl, online = defaultOnline, now, debounceMs, retryMs, autoSync = true } = {}) {
  const configured = isSupabaseConfigured(config);
  const client = configured
    ? createSupabase({ url: config.url, key: config.key, storage, fetch: fetchImpl, now })
    : null;
  const queue = createSyncQueue(storage, SYNC_QUEUE_KEY);
  const listeners = new Set();
  let engine = null;
  let lastUserId = client && client.getSession() ? client.getSession().user.id : null;

  function notify(st) {
    for (const fn of [...listeners]) { try { fn(st); } catch (_) { /* ignore listener errors */ } }
  }

  // The store calls these after every local change. Nothing is recorded when cloud is not configured.
  const hooks = {
    onChange(table, id) { if (engine) engine.recordChange(table, id); },
    onDelete(table, id) { if (engine) engine.recordDelete(table, id); },
  };

  // Called once the store exists. Starts the engine and kicks a sync whenever a new account signs in.
  function attach(store, { onRemoteChange } = {}) {
    if (!client) return;
    engine = createSyncEngine({
      store,
      client,
      queue,
      now: now ? () => new Date(now()).toISOString() : undefined,
      online,
      onStatus: (st) => notify(st),
      onRemoteChange,
      debounceMs,
      retryMs,
      autoSync,
    });
    if (client.getSession()) engine.kick(); // page open with a saved session: pull and push queued changes now
    client.onAuthChange((session) => {
      const uid = session ? session.user.id : null;
      if (uid && uid !== lastUserId) { lastUserId = uid; engine.kick(); } // new sign-in: sync now
      else { if (!uid) lastUserId = null; engine.emit(); }
    });
  }

  function status() {
    if (engine) return engine.status();
    return { state: configured ? 'signed-out' : 'local', pending: 0, lastSyncAt: null, error: null, email: '' };
  }

  function requireClient() {
    if (!client) {
      const e = new Error('Cloud sync is not set up in this build. Everything stays on this device.');
      e.code = 'not-configured';
      throw e;
    }
    return client;
  }

  return {
    configured,
    hooks,
    attach,
    status,
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get email() { return client && client.getSession() ? client.getSession().user.email : ''; },
    signedIn() { return !!(client && client.getSession()); },
    async signUp(email, password) { return requireClient().signUp(email, password); },
    async signIn(email, password) { return requireClient().signIn(email, password); },
    async signOut() {
      if (!client) return { status: 'signed-out' };
      const r = await client.signOut();
      if (engine) engine.emit();
      return r;
    },
    async syncNow() {
      if (!engine) return { ok: false, reason: 'signed-out' };
      return engine.sync();
    },
    // Called on browser 'online' and on page show: pushes anything queued while offline.
    kick() { if (engine) engine.kick(); },
    stop() { if (engine) engine.stop(); },
  };
}
