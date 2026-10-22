// Local persistence: versioned localStorage with JSON backup export/import.
// Stage 1 data lives ONLY on this device/browser. Supabase sync arrives in Stage 3.
import { STORAGE_KEY, SCHEMA_VERSION, SHOT_KINDS, SHOT_MAX_PER_TRADE, SHOT_TOTAL_CAP_CHARS, MAX_REFLECTION, REFLECTION_FIELDS } from './config.js';
import { validateTrade, normalizeTrade } from './trades.js';
import { validateReflection, sanitizeReflections, isDayKey } from './insights.js';
import { screenshotUsage, sanitizeShots } from './shots.js';

export const EMPTY_STATE = () => ({
  schemaVersion: SCHEMA_VERSION,
  trades: [],
  settings: {
    accountCurrency: 'USD',
    startingBalance: null,
    theme: 'dark',
    customInstruments: {},
    defaultRisk: 1,
  },
  reflections: {},
  meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
});

export function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Migrate older schemas. Add a case here for each future schema version.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return EMPTY_STATE();
  let data = raw;
  const v = Number(data.schemaVersion || 0);
  if (v > SCHEMA_VERSION) throw new Error(`Saved data is from a newer app version (schema ${v}). Update the app before loading it.`);
  if (v < 1) data = { ...EMPTY_STATE(), trades: Array.isArray(data.trades) ? data.trades : [] };
  // Schema 1 -> 2 (additive): reflections map and per-trade screenshots default to empty.
  // No existing trade field is removed or rewritten, so Stage 1 data is never lost.
  const base = EMPTY_STATE();
  return {
    ...base,
    ...data,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...(data.settings || {}) },
    trades: Array.isArray(data.trades)
      ? data.trades.filter((t) => t && typeof t === 'object').map((t) => ({ ...t, screenshots: sanitizeShots(t.screenshots) }))
      : [],
    reflections: sanitizeReflections(data.reflections),
    meta: { ...base.meta, ...(data.meta || {}) },
  };
}

// storage: any object with getItem/setItem/removeItem (window.localStorage in browser, Map-backed in tests).
export function createStore(storage, key = STORAGE_KEY) {
  let state = null;

  function load() {
    let text = null;
    try { text = storage.getItem(key); }
    catch (e) { return { ok: false, error: 'Storage is blocked by the browser or Telegram. Trades cannot be saved on this device.' }; }
    if (!text) { state = EMPTY_STATE(); return { ok: true, state, fresh: true }; }
    try {
      state = migrate(JSON.parse(text));
      return { ok: true, state, fresh: false };
    } catch (e) {
      // Keep the corrupt blob so nothing is lost; start fresh in memory.
      try { storage.setItem(key + ':corrupt-' + Date.now(), text); } catch (_) { /* ignore */ }
      state = EMPTY_STATE();
      return { ok: false, error: 'Saved data could not be read. A copy was kept on this device. ' + (e.message || '') };
    }
  }

  function save() {
    if (!state) return { ok: false, error: 'Nothing loaded.' };
    state.meta.updatedAt = new Date().toISOString();
    try {
      storage.setItem(key, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not save: storage is full or blocked. Export a backup, then free space.' };
    }
  }

  return {
    load,
    save,
    get state() { return state; },
    set state(s) { state = s; },
    get trades() { return state ? state.trades : []; },
    upsertTrade(raw) {
      const { valid, errors, trade } = validateTrade(raw);
      if (!valid) return { ok: false, errors };
      const now = new Date().toISOString();
      const idx = trade.id ? state.trades.findIndex((t) => t.id === trade.id) : -1;
      const existing = idx >= 0 ? state.trades[idx] : null;
      // Screenshots are not part of the form, so an edit keeps whatever was already attached.
      const stored = { ...trade, id: trade.id || createId(), createdAt: existing?.createdAt || now, updatedAt: now, screenshots: existing?.screenshots || [] };
      if (idx >= 0) state.trades[idx] = stored; else state.trades.push(stored);
      const r = save();
      return r.ok ? { ok: true, trade: stored } : { ok: false, errors: { _save: r.error } };
    },
    // Screenshots: data URLs already compressed by the caller (shots.js). Enforces per-trade and total caps.
    addScreenshot(tradeId, shot) {
      const t = state.trades.find((x) => x.id === tradeId);
      if (!t) return { ok: false, error: 'Trade not found.' };
      if (!SHOT_KINDS.includes(shot.kind)) return { ok: false, error: 'Choose before or after.' };
      if (!/^data:image\/jpeg;base64,/.test(shot.dataUrl || '')) return { ok: false, error: 'Screenshot must be a compressed JPEG.' };
      const list = Array.isArray(t.screenshots) ? t.screenshots : [];
      if (list.length >= SHOT_MAX_PER_TRADE) return { ok: false, error: `A trade can hold ${SHOT_MAX_PER_TRADE} screenshots. Delete one first.` };
      const used = screenshotUsage(state.trades).chars;
      if (used + shot.dataUrl.length > SHOT_TOTAL_CAP_CHARS) {
        return { ok: false, error: 'Screenshot storage is full (4 MB cap). Delete some screenshots or export a backup and remove old ones.' };
      }
      const item = { id: createId(), kind: shot.kind, dataUrl: shot.dataUrl, width: shot.width || null, height: shot.height || null, bytes: shot.dataUrl.length, createdAt: new Date().toISOString() };
      t.screenshots = [...list, item];
      const r = save();
      return r.ok ? { ok: true, shot: item } : { ok: false, error: r.error };
    },
    removeScreenshot(tradeId, shotId) {
      const t = state.trades.find((x) => x.id === tradeId);
      if (!t) return { ok: false, error: 'Trade not found.' };
      const before = (t.screenshots || []).length;
      t.screenshots = (t.screenshots || []).filter((s) => s.id !== shotId);
      if (t.screenshots.length === before) return { ok: false, error: 'Screenshot not found.' };
      return save();
    },
    // Reflections: one entry per date. Empty text for every field is rejected; use deleteReflection.
    setReflection(dateKey, raw) {
      const v = validateReflection(dateKey, raw);
      if (!v.valid) return { ok: false, errors: v.errors };
      state.reflections = { ...(state.reflections || {}), [dateKey]: { ...v.value, updatedAt: new Date().toISOString() } };
      const r = save();
      return r.ok ? { ok: true } : { ok: false, errors: { _save: r.error } };
    },
    deleteReflection(dateKey) {
      if (!isDayKey(dateKey) || !state.reflections || !state.reflections[dateKey]) return { ok: false, error: 'No reflection for that date.' };
      const next = { ...state.reflections };
      delete next[dateKey];
      state.reflections = next;
      return save();
    },
    deleteTrade(id) {
      const before = state.trades.length;
      state.trades = state.trades.filter((t) => t.id !== id);
      if (state.trades.length === before) return { ok: false, error: 'Trade not found.' };
      return save();
    },
    // Bulk add already-validated normalised trades (used by CSV import).
    addTrades(list) {
      const now = new Date().toISOString();
      for (const t of list) {
        const n = normalizeTrade(t);
        state.trades.push({ ...n, id: createId(), createdAt: now, updatedAt: now });
      }
      return save();
    },
    clearAll() {
      state = EMPTY_STATE();
      return save();
    },
    updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      return save();
    },
    exportBackup() {
      return JSON.stringify({ app: 'zainul-fx-journal', exportedAt: new Date().toISOString(), ...state }, null, 2);
    },
    // Replace all data from a backup file. Validates structure before replacing.
    importBackup(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'Backup is not valid JSON.' }; }
      if (!parsed || parsed.app !== 'zainul-fx-journal' || !Array.isArray(parsed.trades)) {
        return { ok: false, error: 'This file is not a Zainul FX Journal backup.' };
      }
      let next;
      try { next = migrate(parsed); } catch (e) { return { ok: false, error: e.message }; }
      const bad = next.trades.filter((t) => !validateTrade(t).valid).length;
      if (bad) return { ok: false, error: `${bad} trade(s) in the backup failed validation. Nothing was imported.` };
      const previous = state;
      state = next;
      const r = save();
      if (!r.ok) { state = previous; return { ok: false, error: r.error }; }
      return { ok: true, count: next.trades.length };
    },
  };
}
