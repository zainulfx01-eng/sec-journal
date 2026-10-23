// Stage 3 tests: Supabase auth, token refresh, row mapping, store hooks, offline queue, sync engine and last-write-wins.
// All network calls go through a mocked fetch / fake client. No real Supabase project is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabase, isSupabaseConfigured, looksLikeSecretKey, friendlyAuthError, AUTH_STORAGE_KEY } from './supabase.js';
import { createSyncQueue, createSyncEngine, tradeToRow, rowToTrade, reflectionToRow, rowToReflection, SYNC_QUEUE_KEY } from './sync.js';
import { createStore, EMPTY_STATE } from './storage.js';

const PUB_KEY = 'sb_publishable_' + 'a'.repeat(30);
const URL_BASE = 'https://example.supabase.co';

function mem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// Minimal fetch mock. handler(url, init) returns { status, body }.
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  fn.calls = calls;
  return fn;
}

const OPEN_TRADE = { instrument: 'XAUUSD', direction: 'long', status: 'open', entryTime: '2026-10-20T10:00', entryPrice: 2400, lots: 7 };

const trade = (over = {}) => ({
  id: 't1',
  accountName: 'Main',
  instrument: 'XAUUSD',
  direction: 'long',
  status: 'closed',
  entryTime: '2026-10-20T10:00:00.000Z',
  exitTime: '2026-10-20T12:00:00.000Z',
  entryPrice: 2400,
  exitPrice: 2410,
  stopLoss: 2395,
  takeProfit: 2420,
  lots: 7,
  netPL: 70,
  session: 'New York',
  strategy: 'SMC',
  planFollowed: 'yes',
  mistakes: '',
  lessons: 'wait for close',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  screenshots: [],
  ...over,
});

// --- Config and key safety -----------------------------------------------------------------------

test('isSupabaseConfigured accepts the publishable key and a valid https URL', () => {
  assert.equal(isSupabaseConfigured({ url: URL_BASE, key: PUB_KEY }), true);
});

test('isSupabaseConfigured rejects a secret key, a service_role JWT, bad URLs and short keys', () => {
  assert.equal(isSupabaseConfigured({ url: URL_BASE, key: 'sb_secret_' + 'x'.repeat(30) }), false);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const serviceJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.sig`;
  assert.equal(looksLikeSecretKey(serviceJwt), true);
  assert.equal(isSupabaseConfigured({ url: URL_BASE, key: serviceJwt }), false);
  assert.equal(isSupabaseConfigured({ url: 'http://insecure.example', key: PUB_KEY }), false);
  assert.equal(isSupabaseConfigured({ url: URL_BASE, key: 'short' }), false);
  assert.equal(isSupabaseConfigured(null), false);
});

test('createSupabase refuses to start with a secret key', () => {
  assert.throws(() => createSupabase({ url: URL_BASE, key: 'sb_secret_' + 'x'.repeat(30), fetch: mockFetch(() => ({ status: 200 })) }));
});

// --- Auth ------------------------------------------------------------------------------------------

test('signIn stores a session and exposes the user email', async () => {
  const storage = mem();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const fetch = mockFetch(() => ({
    status: 200,
    body: { access_token: 'AT1', refresh_token: 'RT1', expires_at: expiresAt, user: { id: 'u1', email: 'k@example.com' } },
  }));
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage, fetch });
  const r = await client.signIn('k@example.com', 'secret123');
  assert.equal(r.status, 'signed-in');
  assert.equal(client.getSession().user.id, 'u1');
  assert.ok(storage.getItem(AUTH_STORAGE_KEY), 'session persisted');
  assert.match(fetch.calls[0].url, /grant_type=password/);
});

test('signIn with wrong password gives a friendly message', async () => {
  const fetch = mockFetch(() => ({ status: 400, body: { error_description: 'Invalid login credentials' } }));
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage: mem(), fetch });
  await assert.rejects(() => client.signIn('k@example.com', 'bad'), (e) => e.code === 'auth' && e.message === 'Email or password is not right.');
  assert.equal(client.getSession(), null);
});

test('signUp returns confirm status when the project needs email confirmation', async () => {
  const fetch = mockFetch(() => ({ status: 200, body: { id: 'u2', email: 'new@example.com' } }));
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage: mem(), fetch });
  const r = await client.signUp('new@example.com', 'password1');
  assert.deepEqual(r, { status: 'confirm', email: 'new@example.com' });
  assert.equal(client.getSession(), null);
});

test('signUp signs in immediately when a session is returned', async () => {
  const fetch = mockFetch(() => ({ status: 200, body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u3', email: 'a@b.co' } } }));
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage: mem(), fetch });
  const r = await client.signUp('a@b.co', 'password1');
  assert.equal(r.status, 'signed-in');
  assert.equal(client.getSession().user.id, 'u3');
});

test('signOut clears the local session even if the network call fails', async () => {
  const storage = mem();
  const fetch = mockFetch((url) => {
    if (url.includes('grant_type=password')) return { status: 200, body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1', email: 'a@b.co' } } };
    throw new Error('offline');
  });
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage, fetch });
  await client.signIn('a@b.co', 'password1');
  await client.signOut();
  assert.equal(client.getSession(), null);
  assert.equal(storage.getItem(AUTH_STORAGE_KEY), null);
});

test('friendlyAuthError maps common failures and never leaks raw payloads', () => {
  assert.equal(friendlyAuthError(400, { msg: 'User already registered' }), 'An account with this email already exists. Sign in instead.');
  assert.equal(friendlyAuthError(429, {}), 'Too many attempts. Wait a few minutes and try again.');
  assert.equal(friendlyAuthError(0, null), "Can't reach the server. Check your connection and try again.");
  assert.doesNotMatch(friendlyAuthError(500, { message: 'raw {db} dump' }), /raw|db/);
});

test('an expired access token is refreshed before a request is sent', async () => {
  const storage = mem();
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'OLD', refresh_token: 'RT', expires_at: 1000, user: { id: 'u1', email: 'a@b.co' } }));
  const fetch = mockFetch((url) => {
    if (url.includes('grant_type=refresh_token')) return { status: 200, body: { access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1', email: 'a@b.co' } } };
    return { status: 200, body: [] };
  });
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage, fetch, now: () => 5000 * 1000 });
  await client.selectAll('trades', '*');
  const rest = fetch.calls.find((c) => c.url.includes('/rest/v1/'));
  assert.equal(rest.init.headers.Authorization, 'Bearer NEW');
});

test('a dead refresh token signs the device out locally', async () => {
  const storage = mem();
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'OLD', refresh_token: 'RT', expires_at: 1000, user: { id: 'u1', email: 'a@b.co' } }));
  const fetch = mockFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  const client = createSupabase({ url: URL_BASE, key: PUB_KEY, storage, fetch, now: () => 5000 * 1000 });
  await client.selectAll('trades', '*').catch(() => {});
  assert.equal(client.getSession(), null);
});

// --- Mapping ---------------------------------------------------------------------------------------

test('tradeToRow and rowToTrade round-trip a trade through the extra column', () => {
  const t = trade({ screenshots: [{ id: 's1', kind: 'before', dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 4 }] });
  const row = tradeToRow(t, 'u1');
  assert.equal(row.user_id, 'u1');
  assert.equal(row.local_id, 't1');
  assert.equal(row.symbol, 'XAUUSD');
  assert.equal(row.lots, 7);
  assert.equal(row.plan_followed, true);
  const back = rowToTrade({ ...row, created_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(back.id, 't1');
  assert.equal(back.lots, 7);
  assert.equal(back.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(back.screenshots[0].id, 's1');
});

test('rowToTrade returns null for a row without local_id or with an invalid trade', () => {
  assert.equal(rowToTrade({ user_id: 'u1' }), null);
  assert.equal(rowToTrade({ local_id: 'x', symbol: '', direction: 'sideways' }), null);
});

test('reflection row mapping round-trips by date', () => {
  const row = reflectionToRow('2026-10-20', { did_well: 'patience', did_poorly: '', main_lesson: 'wait', improve_tomorrow: 'sleep', updatedAt: '2026-10-20T20:00:00.000Z' }, 'u1');
  assert.equal(row.entry_date, '2026-10-20');
  const back = rowToReflection(row);
  assert.equal(back.day, '2026-10-20');
  assert.equal(back.value.did_well, 'patience');
  assert.equal(back.value.updatedAt, '2026-10-20T20:00:00.000Z');
});

// --- Store hooks -----------------------------------------------------------------------------------

test('local saves fire hooks, remote applies do not (no echo back to the cloud)', () => {
  const calls = [];
  const store = createStore(mem(), 'k', { onChange: (tb, id) => calls.push(['change', tb, id]), onDelete: (tb, id) => calls.push(['delete', tb, id]) });
  store.load();
  const r = store.upsertTrade(OPEN_TRADE);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(calls.length, 1);
  store.applyRemoteTrade(trade({ id: 'remote1' }));
  store.removeLocalTrade('remote1');
  assert.equal(calls.length, 1, 'remote apply must not fire hooks');
});

test('a throwing hook never blocks a local save', () => {
  const store = createStore(mem(), 'k', { onChange: () => { throw new Error('boom'); } });
  store.load();
  const r = store.upsertTrade(OPEN_TRADE);
  assert.equal(r.ok, true);
  assert.equal(store.trades.length, 1);
});

// --- Queue -----------------------------------------------------------------------------------------

test('the sync queue persists dirty and tombstone entries across reloads', () => {
  const storage = mem();
  const q = createSyncQueue(storage);
  q.markDirty('trades', 't1');
  q.markDeleted('trades', 't2', '2026-01-02T00:00:00.000Z');
  const again = createSyncQueue(storage);
  assert.equal(again.pendingCount(), 2);
  assert.ok(storage.getItem(SYNC_QUEUE_KEY));
});

// --- Engine ----------------------------------------------------------------------------------------

// Builds a store wired to an engine with a fake cloud client.
function harness({ online = true, rows = { trades: [], reflections: [] }, now = () => '2026-10-21T00:00:00.000Z' } = {}) {
  const storage = mem();
  const queue = createSyncQueue(storage);
  const client = {
    _session: { user: { id: 'u1', email: 'a@b.co' } },
    getSession() { return this._session; },
    calls: [],
    selectAll: async (table) => { client.calls.push(['select', table]); return rows[table]; },
    upsert: async (table, list, conflict) => { client.calls.push(['upsert', table, list, conflict]); },
    remove: async (table, filter) => { client.calls.push(['remove', table, filter]); },
  };
  let net = online;
  let engine;
  const store = createStore(storage, 'k', {
    onChange: (tb, id) => engine.recordChange(tb, id),
    onDelete: (tb, id) => engine.recordDelete(tb, id),
  });
  store.load();
  engine = createSyncEngine({ store, client, queue, now, online: () => net, autoSync: false });
  return { store, client, queue, engine, setOnline: (v) => { net = v; }, storage };
}

test('an offline edit is queued and pushed later when back online', async () => {
  const h = harness({ online: false });
  h.store.upsertTrade(OPEN_TRADE);
  assert.equal(h.queue.pendingCount(), 1);
  const off = await h.engine.sync();
  assert.equal(off.reason, 'offline');
  assert.equal(h.client.calls.filter((c) => c[0] === 'upsert').length, 0);
  assert.equal(h.queue.pendingCount(), 1, 'queue survives offline');
  h.setOnline(true);
  const on = await h.engine.sync();
  assert.equal(on.ok, true);
  assert.equal(on.pushed, 1);
  assert.equal(h.queue.pendingCount(), 0);
  const up = h.client.calls.find((c) => c[0] === 'upsert');
  assert.equal(up[1], 'trades');
  assert.equal(up[3], 'user_id,local_id');
});

test('a network error during sync keeps the queue and reports offline', async () => {
  const h = harness();
  h.store.upsertTrade(OPEN_TRADE);
  h.client.selectAll = async () => { const e = new Error('net'); e.code = 'network'; throw e; };
  const r = await h.engine.sync();
  assert.equal(r.reason, 'offline');
  assert.equal(h.queue.pendingCount(), 1);
});

test('signed-out engine does nothing and reports signed-out', async () => {
  const h = harness();
  h.client._session = null;
  const r = await h.engine.sync();
  assert.equal(r.reason, 'signed-out');
  assert.equal(h.engine.status().state, 'signed-out');
});

test('last-write-wins: a newer remote row overwrites a clean local trade', async () => {
  const local = trade({ updatedAt: '2026-01-01T00:00:00.000Z', lots: 2 });
  const remoteCopy = { ...local, lots: 9, updatedAt: '2026-02-01T00:00:00.000Z' };
  const h = harness({ rows: { trades: [tradeToRow(remoteCopy, 'u1')], reflections: [] } });
  h.store.applyRemoteTrade(local);
  h.queue.setUser('u1'); // already attached to this account, so no first-sync requeue
  const r = await h.engine.sync();
  assert.equal(r.ok, true);
  assert.equal(h.store.trades[0].lots, 9);
});

test('last-write-wins: a newer local edit beats an older remote row and is pushed', async () => {
  const local = trade({ updatedAt: '2026-03-01T00:00:00.000Z', lots: 4 });
  const oldRemote = { ...local, lots: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
  const h = harness({ rows: { trades: [tradeToRow(oldRemote, 'u1')], reflections: [] } });
  h.store.applyRemoteTrade(local);
  h.queue.setUser('u1');
  h.queue.markDirty('trades', 't1');
  await h.engine.sync();
  assert.equal(h.store.trades[0].lots, 4, 'local newer edit kept');
  const up = h.client.calls.find((c) => c[0] === 'upsert');
  assert.ok(up, 'local edit pushed');
  assert.equal(h.queue.pendingCount(), 0);
});

test('last-write-wins: a queued local edit older than the remote row is replaced by the remote', async () => {
  const local = trade({ updatedAt: '2026-01-01T00:00:00.000Z', lots: 4 });
  const newerRemote = { ...local, lots: 6, updatedAt: '2026-05-01T00:00:00.000Z' };
  const h = harness({ rows: { trades: [tradeToRow(newerRemote, 'u1')], reflections: [] } });
  h.store.applyRemoteTrade(local);
  h.queue.setUser('u1');
  h.queue.markDirty('trades', 't1');
  await h.engine.sync();
  assert.equal(h.store.trades[0].lots, 6);
  assert.equal(h.queue.pendingCount(), 0);
});

test('a trade deleted on another device is removed locally', async () => {
  const local = trade({ updatedAt: '2026-01-01T00:00:00.000Z' });
  const h = harness({ rows: { trades: [], reflections: [] } });
  h.store.applyRemoteTrade(local);
  h.queue.setUser('u1');
  const r = await h.engine.sync();
  assert.equal(r.removed, 1);
  assert.equal(h.store.trades.length, 0);
});

test('a local delete is pushed as a remote delete by local_id', async () => {
  const h = harness();
  h.store.upsertTrade(OPEN_TRADE);
  await h.engine.sync();
  const id = h.store.trades[0].id;
  h.store.deleteTrade(id);
  await h.engine.sync();
  const rm = h.client.calls.find((c) => c[0] === 'remove');
  assert.ok(rm);
  assert.equal(rm[1], 'trades');
  assert.match(rm[2], new RegExp(`local_id=eq\\.${id}`));
});

test('a remote reflection newer than local is applied', async () => {
  const h = harness({ rows: { trades: [], reflections: [{ entry_date: '2026-10-20', did_well: 'cloud', did_poorly: '', main_lesson: '', improve_tomorrow: '', updated_at: '2026-10-21T10:00:00.000Z' }] } });
  h.store.applyRemoteReflection('2026-10-20', { did_well: 'old', did_poorly: '', main_lesson: '', improve_tomorrow: '', updatedAt: '2026-10-20T10:00:00.000Z' });
  h.queue.setUser('u1');
  await h.engine.sync();
  assert.equal(h.store.state.reflections['2026-10-20'].did_well, 'cloud');
});

test('onRemoteChange fires only when remote data was applied', async () => {
  let fired = 0;
  const h = harness();
  const engine = createSyncEngine({ store: h.store, client: h.client, queue: h.queue, online: () => true, autoSync: false, onRemoteChange: () => { fired++; } });
  await engine.sync();
  assert.equal(fired, 0);
});

test('status reports pending and synced states', async () => {
  const h = harness();
  assert.equal(h.engine.status().state, 'synced');
  h.store.upsertTrade(OPEN_TRADE);
  assert.equal(h.engine.status().state, 'pending');
  await h.engine.sync();
  assert.equal(h.engine.status().state, 'synced');
});

test('local-only save still works with no engine attached', () => {
  const store = createStore(mem(), 'k');
  store.load();
  const r = store.upsertTrade(OPEN_TRADE);
  assert.equal(r.ok, true);
  assert.ok(EMPTY_STATE().trades);
});
