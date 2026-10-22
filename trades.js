// Trade model: normalisation, validation, filtering, sorting and dashboard statistics.
// Pure functions only. Storage and DOM live elsewhere.
import { DIRECTIONS, STATUSES, PLAN_VALUES, MAX_TEXT, MAX_SHORT_TEXT, MAX_LOTS, TRADE_FIELDS } from './config.js';
import { normalizeSymbol, computeNetPL, plannedRRFromPrices, realizedR, classifyResult, round2, BE_EPS, LOT_STEP } from './calc.js';

const TEXT_FIELDS = TRADE_FIELDS.filter((f) => f.type === 'text').map((f) => f.key);
const NUM_FIELDS = ['entryPrice', 'exitPrice', 'stopLoss', 'takeProfit', 'lots', 'initialRisk', 'commission', 'otherCosts', 'plannedRR'];
const SIGNED_FIELDS = ['grossPL', 'swap', 'netPL'];
const LONG_TEXT = ['entryReason', 'exitReason', 'emotionsBefore', 'emotionsDuring', 'mistakes', 'lessons'];

const str = (v) => (v == null ? '' : String(v).trim());
const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN; // NaN marks an invalid numeric so validation can report it
};

// Convert a datetime-local string or ISO into canonical ISO (UTC). Returns null when empty, NaN when invalid.
export function toIsoOrNull(v) {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? NaN : d.toISOString();
}

// Trim text, normalise symbol and enums, convert numerics. Does NOT validate.
export function normalizeTrade(raw = {}) {
  const t = {
    id: raw.id || null,
    accountName: str(raw.accountName),
    instrument: normalizeSymbol(raw.instrument),
    direction: str(raw.direction).toLowerCase(),
    status: str(raw.status || 'closed').toLowerCase(),
    entryTime: toIsoOrNull(raw.entryTime),
    exitTime: toIsoOrNull(raw.exitTime),
    accountCurrency: str(raw.accountCurrency).toUpperCase(),
    session: str(raw.session),
    strategy: str(raw.strategy),
    planFollowed: str(raw.planFollowed).toLowerCase(),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
  for (const k of NUM_FIELDS) t[k] = numOrNull(raw[k]);
  for (const k of SIGNED_FIELDS) t[k] = numOrNull(raw[k]);
  for (const k of LONG_TEXT) t[k] = str(raw[k]);
  // Net P/L: if a broker gross figure is entered, compute net from costs. Otherwise keep netPL as entered.
  if (t.grossPL != null && !Number.isNaN(t.grossPL)) {
    t.netPL = computeNetPL({ grossPL: t.grossPL, commission: t.commission, swap: t.swap, otherCosts: t.otherCosts });
  }
  if (t.netPL != null && Number.isNaN(t.netPL)) t.netPL = NaN;
  // Derived fields are recomputed from inputs on every save so they never go stale.
  t.plannedRR = plannedRRFromPrices({ entryPrice: t.entryPrice, stopLoss: t.stopLoss, takeProfit: t.takeProfit }) ?? (Number.isNaN(t.plannedRR) ? null : t.plannedRR);
  t.realizedR = realizedR({ netPL: t.netPL, initialRisk: t.initialRisk }) ?? null;
  t.result = t.status === 'closed' ? classifyResult(t.netPL) : 'open';
  return t;
}

// Returns { valid: boolean, errors: { field: message }, trade }
export function validateTrade(raw) {
  const t = normalizeTrade(raw);
  const errors = {};
  const set = (k, m) => { if (!errors[k]) errors[k] = m; };

  if (!t.instrument) set('instrument', 'Instrument is required.');
  else if (t.instrument.length > 20 || !/^[A-Z0-9.]+$/.test(t.instrument)) set('instrument', 'Use letters and numbers only (e.g. EURUSD, XAUUSD).');
  if (!DIRECTIONS.includes(t.direction)) set('direction', 'Choose long or short.');
  if (!STATUSES.includes(t.status)) set('status', 'Choose open or closed.');
  if (t.entryTime == null) set('entryTime', 'Entry time is required.');
  else if (Number.isNaN(t.entryTime)) set('entryTime', 'Entry time is not a valid date.');
  if (t.exitTime != null && Number.isNaN(t.exitTime)) set('exitTime', 'Exit time is not a valid date.');
  if (t.entryTime && t.exitTime && !Number.isNaN(t.exitTime) && t.exitTime < t.entryTime) set('exitTime', 'Exit time cannot be before entry time.');

  const posNum = (k, label) => {
    const v = t[k];
    if (v == null) return;
    if (Number.isNaN(v)) return set(k, `${label} must be a number.`);
    if (v <= 0) set(k, `${label} must be greater than 0.`);
  };
  posNum('entryPrice', 'Entry price');
  posNum('exitPrice', 'Exit price');
  posNum('stopLoss', 'Stop loss');
  posNum('takeProfit', 'Take profit');
  posNum('initialRisk', 'Initial risk');
  if (t.initialRisk != null && t.initialRisk === 0) set('initialRisk', 'Initial risk must be greater than 0 (or leave blank).');

  if (t.lots == null) set('lots', 'Lots is required.');
  else if (Number.isNaN(t.lots)) set('lots', 'Lots must be a number.');
  else if (t.lots <= 0) set('lots', 'Lots must be greater than 0.');
  else if (t.lots > MAX_LOTS) set('lots', `Lots cannot exceed ${MAX_LOTS}.`);
  else if (Math.abs(t.lots / LOT_STEP - Math.round(t.lots / LOT_STEP)) > 1e-6) set('lots', 'Lots must be in steps of 0.01.');

  for (const k of ['commission', 'otherCosts']) {
    const v = t[k];
    if (v != null && (Number.isNaN(v) || v < 0)) set(k, 'Costs must be 0 or more (enter them as positive numbers).');
  }
  for (const k of ['swap', 'grossPL', 'netPL']) {
    if (t[k] != null && Number.isNaN(t[k])) set(k, 'Must be a number (negative for losses).');
  }
  if (t.accountCurrency && !/^[A-Z]{3}$/.test(t.accountCurrency)) set('accountCurrency', 'Use a 3-letter code, e.g. USD.');
  if (t.planFollowed && !PLAN_VALUES.includes(t.planFollowed)) set('planFollowed', 'Choose yes, partial or no.');

  // Stop / target sides
  if (t.entryPrice > 0 && t.stopLoss > 0) {
    if (t.entryPrice === t.stopLoss) set('stopLoss', 'Stop loss cannot equal entry (zero risk distance).');
    else if (t.direction === 'long' && t.stopLoss > t.entryPrice) set('stopLoss', 'For a long, stop loss must be below entry.');
    else if (t.direction === 'short' && t.stopLoss < t.entryPrice) set('stopLoss', 'For a short, stop loss must be above entry.');
  }
  if (t.entryPrice > 0 && t.takeProfit > 0) {
    if (t.direction === 'long' && t.takeProfit < t.entryPrice) set('takeProfit', 'For a long, take profit must be above entry.');
    if (t.direction === 'short' && t.takeProfit > t.entryPrice) set('takeProfit', 'For a short, take profit must be below entry.');
  }

  // Closed trade requirements
  if (t.status === 'closed') {
    if (t.exitTime == null) set('exitTime', 'Closed trades need an exit time.');
    if (t.exitPrice == null) set('exitPrice', 'Closed trades need an exit price.');
    if (t.netPL == null && t.grossPL == null) set('netPL', 'Closed trades need a net P/L (or a gross P/L with costs).');
  }
  if (t.status === 'open') {
    if (t.exitTime != null) set('exitTime', 'Open trades cannot have an exit time. Set status to closed.');
    if (t.exitPrice != null) set('exitPrice', 'Open trades cannot have an exit price. Set status to closed.');
    if (t.netPL != null || t.grossPL != null) set('netPL', 'Open trades cannot have a P/L yet.');
  }

  for (const k of [...TEXT_FIELDS]) {
    const max = k === 'accountName' || k === 'strategy' || k === 'session' || k === 'instrument' ? MAX_SHORT_TEXT : MAX_TEXT;
    if (t[k] && t[k].length > max) set(k, `Max ${max} characters.`);
  }
  for (const k of LONG_TEXT) {
    if (t[k] && t[k].length > MAX_TEXT) set(k, `Max ${MAX_TEXT} characters.`);
  }

  return { valid: Object.keys(errors).length === 0, errors, trade: t };
}

// Stable fingerprint used for duplicate detection on import and for warning the user.
export function tradeFingerprint(t) {
  const n = (v) => (v == null || Number.isNaN(v) ? '' : Number(v).toFixed(5));
  return [
    normalizeSymbol(t.instrument),
    t.direction,
    t.entryTime || '',
    n(t.entryPrice),
    n(t.lots),
    (t.accountName || '').toLowerCase(),
  ].join('|');
}

// --- Filtering and sorting -------------------------------------------------

export const RESULT_FILTERS = ['all', 'profit', 'loss', 'breakeven', 'open'];
export const SORT_KEYS = ['date-desc', 'date-asc', 'symbol-asc', 'result-desc', 'pl-desc', 'pl-asc'];

export function filterTrades(trades, f = {}) {
  const q = str(f.search).toLowerCase();
  const symbol = normalizeSymbol(f.symbol || '');
  const from = f.from ? new Date(f.from + 'T00:00:00').getTime() : null;
  const to = f.to ? new Date(f.to + 'T23:59:59.999').getTime() : null;
  return trades.filter((t) => {
    if (f.result && f.result !== 'all') {
      if (f.result === 'open' && t.status !== 'open') return false;
      if (f.result !== 'open' && (t.status !== 'closed' || t.result !== f.result)) return false;
    }
    if (symbol && t.instrument !== symbol) return false;
    if (f.session && f.session !== 'all' && t.session !== f.session) return false;
    if (f.strategy && f.strategy !== 'all' && t.strategy !== f.strategy) return false;
    const et = t.entryTime ? new Date(t.entryTime).getTime() : null;
    if (from != null && (et == null || et < from)) return false;
    if (to != null && (et == null || et > to)) return false;
    if (q) {
      const hay = [t.instrument, t.accountName, t.strategy, t.session, t.entryReason, t.exitReason, t.mistakes, t.lessons, t.emotionsBefore, t.emotionsDuring]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortTrades(trades, key = 'date-desc') {
  const arr = [...trades];
  const time = (t) => (t.entryTime ? new Date(t.entryTime).getTime() : 0);
  const pl = (t) => (t.netPL == null || Number.isNaN(t.netPL) ? -Infinity : t.netPL);
  const rank = { profit: 3, breakeven: 2, loss: 1, open: 0, unknown: 0 };
  const cmp = {
    'date-desc': (a, b) => time(b) - time(a),
    'date-asc': (a, b) => time(a) - time(b),
    'symbol-asc': (a, b) => a.instrument.localeCompare(b.instrument) || time(b) - time(a),
    'result-desc': (a, b) => (rank[b.result] ?? 0) - (rank[a.result] ?? 0) || time(b) - time(a),
    'pl-desc': (a, b) => pl(b) - pl(a),
    'pl-asc': (a, b) => pl(a) - pl(b),
  }[key] || ((a, b) => time(b) - time(a));
  return arr.sort(cmp);
}

// --- Dashboard statistics --------------------------------------------------

// Period bounds in the device's local time. period: today | week | month | all
export function periodRange(period, now = new Date()) {
  if (period === 'all' || !period) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') {
    const day = (start.getDay() + 6) % 7; // Monday as first day
    start.setDate(start.getDate() - day);
  } else if (period === 'month') {
    start.setDate(1);
  }
  return { from: start.getTime(), to: now.getTime() + 1 };
}

// Compute dashboard stats from closed trades within a period. Open trades are excluded from P/L.
export function computeStats(trades, { period = 'all', startingBalance = null, now = new Date() } = {}) {
  const range = periodRange(period, now);
  const inPeriod = (t) => {
    if (!range) return true;
    const ref = t.exitTime || t.entryTime;
    const ms = ref ? new Date(ref).getTime() : NaN;
    return !Number.isNaN(ms) && ms >= range.from && ms < range.to;
  };
  const closed = trades
    .filter((t) => t.status === 'closed' && t.netPL != null && !Number.isNaN(t.netPL) && inPeriod(t))
    .sort((a, b) => new Date(a.exitTime || a.entryTime) - new Date(b.exitTime || b.entryTime));

  let winners = 0, losers = 0, breakeven = 0, grossWin = 0, grossLoss = 0, net = 0;
  const rs = [];
  for (const t of closed) {
    const c = classifyResult(t.netPL);
    net += t.netPL;
    if (c === 'profit') { winners++; grossWin += t.netPL; }
    else if (c === 'loss') { losers++; grossLoss += -t.netPL; }
    else breakeven++;
    const r = realizedR({ netPL: t.netPL, initialRisk: t.initialRisk });
    if (r != null) rs.push(r);
  }
  const total = closed.length;

  // Equity curve: cumulative net P/L over closed trades in the period, starting at 0 (or the starting balance).
  const base = startingBalance != null && Number.isFinite(Number(startingBalance)) ? Number(startingBalance) : 0;
  let running = base;
  let peak = base;
  let maxDdAbs = 0;
  let maxDdPct = 0;
  const curve = [{ x: 'start', t: null, y: round2(base), label: 'Start', pl: 0 }];
  for (const t of closed) {
    running += t.netPL;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDdAbs) { maxDdAbs = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0; }
    curve.push({ x: t.exitTime || t.entryTime, t: t.id, y: round2(running), label: t.instrument, pl: t.netPL });
  }

  const currentBalance = startingBalance != null && Number.isFinite(Number(startingBalance))
    ? round2(Number(startingBalance) + allTimeNet(trades))
    : null;

  let profitFactor;
  if (grossLoss === 0) profitFactor = grossWin > 0 ? Infinity : null;
  else profitFactor = round2(grossWin / grossLoss);

  return {
    period,
    totalClosed: total,
    openCount: trades.filter((t) => t.status === 'open').length,
    net: round2(net),
    winners,
    losers,
    breakeven,
    winRate: total ? round2((winners / total) * 100) : null,
    profitFactor,
    avgR: rs.length ? round2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    rCount: rs.length,
    currentBalance,
    maxDrawdownAbs: round2(maxDdAbs),
    maxDrawdownPct: round2(maxDdPct),
    curve,
  };
}

function allTimeNet(trades) {
  return trades
    .filter((t) => t.status === 'closed' && t.netPL != null && !Number.isNaN(t.netPL))
    .reduce((s, t) => s + t.netPL, 0);
}

export function distinctValues(trades, key) {
  return [...new Set(trades.map((t) => t[key]).filter(Boolean))].sort();
}
