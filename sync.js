// Sync engine for Zainul FX Journal (Stage 3). Pure logic plus injected dependencies, so it is fully testable with a mocked fetch.
//
// Model
// - Trades are keyed in the cloud by (user_id, local_id), where local_id is the app's trade id.
// - Reflections are keyed by (user_id, entry_date).
// - Every local change is recorded in a persisted queue (dirty set + tombstones) BEFORE any network call,
//   so offline edits survive a reload and sync later.
// - Conflict rule: last-write-wins on updated_at (client clock, ISO, millisecond precision).
//   A remote edit newer than a local deletion restores the row; a local deletion newer than the remote row deletes it.
// - Rows that are absent from the cloud and not queued locally were deleted on another device, so they are removed here.
import { TRADE_FIELDS, REFLECTION_FIELDS } from './config.js';
import { normalizeTrade, validateTrade } from './trades.js';
import { sanitizeReflections } from './insights.js';
import { sanitizeShots } from './shots.js';

export const SYNC_QUEUE_KEY = 'zainul-fx-journal:sync';
export const PUSH_CHUNK = 50;

const ms = (iso) => {
  if (iso == null || iso === '') return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};
const isoOrNull = (v) => {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const numOrNull = (v) => (v == null || Number.isNaN(v) ? null : Number(v));

// --- Mapping -----------------------------------------------------------------------------------

// Local trade -> trades row. The mapped columns are readable in the Supabase table editor;
// `extra` keeps the full normalised record so nothing is lost on the round trip.
export function tradeToRow(t, userId) {
  const { id, screenshots, ...record } = t;
  const planned = t.planFollowed === 'yes' ? true : t.planFollowed === 'no' ? false : null;
  return {
    user_id: userId,
    local_id: String(id),
    symbol: t.instrument,
    direction: t.direction,
    entry_price: numOrNull(t.entryPrice),
    exit_price: numOrNull(t.exitPrice),
    lots: numOrNull(t.lots),
    stop_loss: numOrNull(t.stopLoss),
    take_profit: numOrNull(t.takeProfit),
    pnl: numOrNull(t.netPL),
    opened_at: isoOrNull(t.entryTime),
    closed_at: isoOrNull(t.exitTime),
    session: t.session || null,
    strategy: t.strategy || null,
    plan_followed: planned,
    mistakes: t.mistakes || null,
    lessons: t.lessons || null,
    emotions: [t.emotionsBefore, t.emotionsDuring].filter(Boolean).join(' / ') || null,
    screenshots: Array.isArray(screenshots) ? screenshots : [],
    extra: record,
    updated_at: isoOrNull(t.updatedAt) || new Date().toISOString(),
  };
}

// trades row -> local trade, or null when the row cannot be made valid.
export function rowToTrade(row) {
  if (!row || !row.local_id) return null;
  const extra = row.extra && typeof row.extra === 'object' && !Array.isArray(row.extra) ? row.extra : null;
  const raw = extra ? { ...extra } : {
    instrument: row.symbol,
    direction: row.direction,
    entryTime: row.opened_at,
    exitTime: row.closed_at,
    status: row.closed_at ? 'closed' : 'open',
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    lots: row.lots,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    netPL: row.pnl,
    session: row.session,
    strategy: row.strategy,
    planFollowed: row.plan_followed === true ? 'yes' : row.plan_followed === false ? 'no' : '',
    mistakes: row.mistakes,
    lessons: row.lessons,
  };
  delete raw.id;
  delete raw.screenshots;
  const t = normalizeTrade(raw);
  if (!validateTrade(t).valid) return null;
  t.id = String(row.local_id);
  t.screenshots = sanitizeShots(row.screenshots);
  t.createdAt = extra?.createdAt || isoOrNull(row.created_at) || null;
  t.updatedAt = isoOrNull(row.updated_at) || t.createdAt || new Date(0).toISOString();
  return t;
}

export function reflectionToRow(dateKey, r, userId) {
  const row = { user_id: userId, entry_date: dateKey };
  for (const f of REFLECTION_FIELDS) row[f.key] = String(r[f.key] == null ? '' : r[f.key]);
  row.updated_at = isoOrNull(r.updatedAt) || new Date().toISOString();
  return row;
}

export function rowToReflection(row) {
  const day = String(row.entry_date || '').slice(0, 10);
  const entry = {};
  for (const f of REFLECTION_FIELDS) entry[f.key] = String(row[f.key] == null ? '' : row[f.key]);
  entry.updatedAt = isoOrNull(row.updated_at) || new Date(0).toISOString();
  const clean = sanitizeReflections({ [day]: entry });
  return clean[day] ? { day, value: clean[day] } : null;
}

// --- Queue (persisted offline changes) ---------------------------------------------------------

function emptyQueue() {
  return { userId: null, lastSyncAt: null, dirty: { trades: {}, reflections: {} }, tombstones: { trades: {}, reflections: {} } };
}

export function createSyncQueue(storage, key = SYNC_QUEUE_KEY) {
  let q = load();

  function load() {
    try {
      const text = storage && storage.getItem(key);
      if (!text) return emptyQueue();
      const p = JSON.parse(text);
      const base = emptyQueue();
      return {
        userId: typeof p.userId === 'string' ? p.userId : null,
        lastSyncAt: typeof p.lastSyncAt === 'string' ? p.lastSyncAt : null,
        dirty: { trades: { ...base.dirty.trades, ...(p.dirty?.trades || {}) }, reflections: { ...base.dirty.reflections, ...(p.dirty?.reflections || {}) } },
        tombstones: { trades: { ...base.tombstones.trades, ...(p.tombstones?.trades || {}) }, reflections: { ...base.tombstones.reflections, ...(p.tombstones?.reflections || {}) } },
      };
    } catch (_) {
      return emptyQueue();
    }
  }

  function save() {
    try { if (storage) storage.setItem(key, JSON.stringify(q)); } catch (_) { /* storage blocked: queue lives in memory */ }
  }

  return {
    get data() { return q; },
    markDirty(table, id) { q.dirty[table][id] = true; delete q.tombstones[table][id]; save(); },
    markDeleted(table, id, at) { delete q.dirty[table][id]; q.tombstones[table][id] = at; save(); },
    clearDirty(table, id) { delete q.dirty[table][id]; save(); },
    clearTombstone(table, id) { delete q.tombstones[table][id]; save(); },
    setUser(userId) { q.userId = userId; save(); },
    setLastSync(iso) { q.lastSyncAt = iso; save(); },
    reset() { q = { ...emptyQueue(), userId: q.userId, lastSyncAt: q.lastSyncAt }; save(); },
    pendingCount() {
      return Object.keys(q.dirty.trades).length + Object.keys(q.dirty.reflections).length
        + Object.keys(q.tombstones.trades).length + Object.keys(q.tombstones.reflections).length;
    },
  };
}

// --- Engine ------------------------------------------------------------------------------------

// deps: { store, client, queue, now?, online?, onStatus?, debounceMs?, schedule? }
// client: createSupabase() instance (getSession, selectAll, upsert, remove).
export function createSyncEngine({ store, client, queue, now = () => new Date().toISOString(), online = () => true, onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 1500, retryMs = 60000, autoSync = true }) {
  let running = null;
  let rerun = false;
  let timer = null;
  let lastError = null;
  let phase = 'idle';

  // After a failed run, try again later while signed in. Offline runs retry too (they are cheap: no network).
  function retryLater() {
    if (!autoSync || !client.getSession()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(); }, retryMs);
  }

  function status() {
    const session = client.getSession();
    const pending = queue.pendingCount();
    let state;
    if (!session) state = 'signed-out';
    else if (phase === 'syncing') state = 'syncing';
    else if (!online()) state = 'offline';
    else if (lastError) state = 'error';
    else state = pending ? 'pending' : 'synced';
    return { state, pending, lastSyncAt: queue.data.lastSyncAt, error: lastError, email: session ? session.user.email : '' };
  }

  function emit() { try { onStatus(status()); } catch (_) { /* UI errors must not break sync */ } }

  function schedule() {
    if (!autoSync || !client.getSession()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(); }, debounceMs);
  }

  // Called by the store on every local mutation. Recorded immediately, pushed when possible.
  function recordChange(table, id) {
    queue.markDirty(table, String(id));
    emit();
    schedule();
  }
  function recordDelete(table, id) {
    queue.markDeleted(table, String(id), now());
    emit();
    schedule();
  }

  async function sync() {
    if (running) { rerun = true; return running; }
    running = run().finally(() => {
      running = null;
      if (rerun) { rerun = false; sync(); }
    });
    return running;
  }

  async function run() {
    const session = client.getSession();
    if (!session) { phase = 'idle'; emit(); return { ok: false, reason: 'signed-out' }; }
    if (!online()) { phase = 'idle'; emit(); return { ok: false, reason: 'offline' }; }
    const userId = session.user.id;

    if (queue.data.userId && queue.data.userId !== userId) {
      // Another account used this device. Its local edits must not leak into this account.
      if (queue.pendingCount() > 0) {
        phase = 'idle'; lastError = 'Sign in to the previous account first to sync its pending changes.'; emit();
        return { ok: false, reason: 'error', error: lastError };
      }
      // Its synced data is removed from this device; the cloud copy stays with that account.
      for (const t of [...store.state.trades]) store.removeLocalTrade(t.id);
      for (const d of Object.keys(store.state.reflections || {})) store.removeLocalReflection(d);
    }
    if (queue.data.userId !== userId) {
      // First sync for this account: everything on this device is queued so it merges into the account.
      queue.reset();
      queue.setUser(userId);
      for (const t of store.state.trades) queue.markDirty('trades', t.id);
      for (const d of Object.keys(store.state.reflections || {})) queue.markDirty('reflections', d);
    }

    phase = 'syncing';
    lastError = null;
    emit();
    const result = { pulled: 0, removed: 0, pushed: 0, deleted: 0, skipped: 0 };
    try {
      const [tradeRows, reflectionRows] = await Promise.all([
        client.selectAll('trades', '*'),
        client.selectAll('reflections', '*'),
      ]);
      pullTrades(tradeRows, result);
      pullReflections(reflectionRows, result);
      await pushTrades(userId, result);
      await pushReflections(userId, result);
      queue.setLastSync(now());
      phase = 'idle';
      emit();
      if (result.pulled || result.removed) { try { onRemoteChange(result); } catch (_) { /* UI refresh must not break sync */ } }
      if (queue.pendingCount()) retryLater();
      return { ok: true, ...result };
    } catch (e) {
      phase = 'idle';
      if (e && e.code === 'session') {
        // A dead refresh token signs the device out locally; the queue is kept for the next sign-in.
        lastError = e.message;
      } else if (e && e.code === 'network') {
        lastError = null; // reported as offline by status()
        emit();
        retryLater();
        return { ok: false, reason: 'offline', ...result };
      } else {
        lastError = (e && e.message) || 'Sync failed.';
      }
      emit();
      retryLater();
      return { ok: false, reason: 'error', error: lastError, ...result };
    }
  }

  function pullTrades(rows, result) {
    const cloud = new Map();
    for (const row of rows) if (row && row.local_id) cloud.set(String(row.local_id), row);
    const localById = new Map(store.state.trades.map((t) => [t.id, t]));

    for (const [id, row] of cloud) {
      const remoteMs = ms(row.updated_at);
      const tomb = queue.data.tombstones.trades[id];
      if (tomb) {
        if (remoteMs > ms(tomb)) queue.clearTombstone('trades', id); // remote edit is newer than our delete: keep it
        else continue; // our delete is newer: it will be pushed below
      }
      const local = localById.get(id);
      if (!local) {
        const t = rowToTrade(row);
        if (t) { store.applyRemoteTrade(t); result.pulled++; } else result.skipped++;
        continue;
      }
      if (queue.data.dirty.trades[id]) {
        // Local change is queued: last write wins on the timestamps.
        if (remoteMs > ms(local.updatedAt)) {
          const t = rowToTrade(row);
          if (t) { store.applyRemoteTrade(t); queue.clearDirty('trades', id); result.pulled++; }
        }
      } else if (remoteMs > ms(local.updatedAt)) {
        const t = rowToTrade(row);
        if (t) { store.applyRemoteTrade(t); result.pulled++; } else result.skipped++;
      }
    }

    // Local trades that are not in the cloud and not queued were deleted on another device.
    for (const t of [...store.state.trades]) {
      if (cloud.has(t.id) || queue.data.dirty.trades[t.id]) continue;
      store.removeLocalTrade(t.id);
      result.removed++;
    }
  }

  function pullReflections(rows, result) {
    const cloud = new Map();
    for (const row of rows) {
      const parsed = rowToReflection(row || {});
      if (parsed) cloud.set(parsed.day, { ...parsed, row });
    }
    const local = store.state.reflections || {};

    for (const [day, { value }] of cloud) {
      const remoteMs = ms(value.updatedAt);
      const tomb = queue.data.tombstones.reflections[day];
      if (tomb) {
        if (remoteMs > ms(tomb)) queue.clearTombstone('reflections', day);
        else continue;
      }
      const mine = local[day];
      if (!mine) { store.applyRemoteReflection(day, value); result.pulled++; continue; }
      if (queue.data.dirty.reflections[day]) {
        if (remoteMs > ms(mine.updatedAt)) { store.applyRemoteReflection(day, value); queue.clearDirty('reflections', day); result.pulled++; }
      } else if (remoteMs > ms(mine.updatedAt)) {
        store.applyRemoteReflection(day, value); result.pulled++;
      }
    }

    for (const day of Object.keys(local)) {
      if (cloud.has(day) || queue.data.dirty.reflections[day]) continue;
      store.removeLocalReflection(day);
      result.removed++;
    }
  }

  async function pushTrades(userId, result) {
    const ids = Object.keys(queue.data.dirty.trades);
    const batch = [];
    for (const id of ids) {
      const t = store.state.trades.find((x) => x.id === id);
      if (!t) { queue.clearDirty('trades', id); continue; }
      batch.push({ id, stamp: t.updatedAt, row: tradeToRow(t, userId) });
    }
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const chunk = batch.slice(i, i + PUSH_CHUNK);
      await client.upsert('trades', chunk.map((b) => b.row), 'user_id,local_id');
      for (const b of chunk) {
        const cur = store.state.trades.find((x) => x.id === b.id);
        // Only clear if nothing changed locally while the request was in flight.
        if (!cur || cur.updatedAt === b.stamp) queue.clearDirty('trades', b.id);
        result.pushed++;
      }
    }
    for (const id of Object.keys(queue.data.tombstones.trades)) {
      await client.remove('trades', `user_id=eq.${encodeURIComponent(userId)}&local_id=eq.${encodeURIComponent(id)}`);
      queue.clearTombstone('trades', id);
      result.deleted++;
    }
  }

  async function pushReflections(userId, result) {
    const days = Object.keys(queue.data.dirty.reflections);
    const batch = [];
    for (const day of days) {
      const r = (store.state.reflections || {})[day];
      if (!r) { queue.clearDirty('reflections', day); continue; }
      batch.push({ day, stamp: r.updatedAt, row: reflectionToRow(day, r, userId) });
    }
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const chunk = batch.slice(i, i + PUSH_CHUNK);
      await client.upsert('reflections', chunk.map((b) => b.row), 'user_id,entry_date');
      for (const b of chunk) {
        const cur = (store.state.reflections || {})[b.day];
        if (!cur || cur.updatedAt === b.stamp) queue.clearDirty('reflections', b.day);
        result.pushed++;
      }
    }
    for (const day of Object.keys(queue.data.tombstones.reflections)) {
      await client.remove('reflections', `user_id=eq.${encodeURIComponent(userId)}&entry_date=eq.${encodeURIComponent(day)}`);
      queue.clearTombstone('reflections', day);
      result.deleted++;
    }
  }

  return {
    sync,
    status,
    recordChange,
    recordDelete,
    emit,
    // Store hook adapter: { onChange, onDelete }
    hooks: {
      onChange: (table, id) => recordChange(table, id),
      onDelete: (table, id) => recordDelete(table, id),
    },
    // Used by the browser on 'online' and after sign-in.
    kick() { if (client.getSession()) sync(); else emit(); },
    stop() { clearTimeout(timer); },
    _pullTrades: pullTrades,
  };
}

export const SYNCED_TRADE_FIELDS = TRADE_FIELDS.map((f) => f.key);
