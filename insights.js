// Stage 2 insight engine: pure functions over trade and reflection records. No DOM.
// Everything here is DESCRIPTIVE. It summarises what is already in the journal. It shows
// co-occurrence, not cause, and it does not predict or guarantee future profit.
// Days are bucketed in APP_TIMEZONE (Africa/Lagos, WAT). Closed trades count on their exit day.
import { classifyResult, BE_EPS, round1, round2 } from './calc.js';
import { APP_TIMEZONE, REFLECTION_FIELDS, MAX_REFLECTION } from './config.js';
import { computeStats } from './trades.js';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DISCIPLINE_NOTE = 'These are descriptive patterns in your own notes. They show what showed up together, not what caused wins or losses, and they do not predict or guarantee profitability.';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'short' });

// 'YYYY-MM-DD' for an ISO instant, in the journal timezone. null when missing or invalid.
export function dayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const x of dayFmt.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// 'Mon'..'Sun' for an ISO instant, in the journal timezone.
export function weekdayName(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return wdFmt.format(d);
}

export function isDayKey(s) {
  return typeof s === 'string' && DAY_RE.test(s) && addDays(s, 0) === s;
}

// Add n days to a 'YYYY-MM-DD' key (calendar arithmetic, no timezone drift).
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Monday = 0 ... Sunday = 6
function mondayIndex(key) {
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// The day a trade belongs to on the calendar: closed trades on exit day, open trades on entry day.
export function calendarKey(t) {
  return t.status === 'closed' ? dayKey(t.exitTime || t.entryTime) : dayKey(t.entryTime);
}

// True only for closed trades with a usable net P/L.
export function hasPL(t) {
  return !!t && t.status === 'closed' && t.netPL != null && Number.isFinite(Number(t.netPL));
}

// Date range presets. Dates are WAT day keys. Empty string means open-ended.
export function presetRange(preset, todayKey, custom = {}) {
  if (preset === 'week') return { from: addDays(todayKey, -mondayIndex(todayKey)), to: todayKey };
  if (preset === 'month') return { from: todayKey.slice(0, 8) + '01', to: todayKey };
  if (preset === 'last30') return { from: addDays(todayKey, -29), to: todayKey };
  if (preset === 'custom') return { from: isDayKey(custom.from) ? custom.from : '', to: isDayKey(custom.to) ? custom.to : '' };
  return { from: '', to: '' };
}

function inRange(k, from, to) {
  if (!from && !to) return true;
  if (!k) return false;
  if (from && k < from) return false;
  if (to && k > to) return false;
  return true;
}

// Closed trades with P/L whose calendar day falls in the range.
export function filterAnalytics(trades, { from = '', to = '' } = {}) {
  return trades.filter((t) => hasPL(t) && inRange(calendarKey(t), from, to));
}

// Core per-group summary. Profit factor is null when there are no gross losses.
export function summarize(trades) {
  const closed = trades.filter(hasPL);
  let winners = 0, losers = 0, breakeven = 0, grossWin = 0, grossLoss = 0, net = 0;
  let bestW = null, worstL = null;
  for (const t of closed) {
    net += t.netPL;
    const c = classifyResult(t.netPL);
    if (c === 'profit') {
      winners++; grossWin += t.netPL;
      if (!bestW || t.netPL > bestW.netPL) bestW = t;
    } else if (c === 'loss') {
      losers++; grossLoss += -t.netPL;
      if (!worstL || t.netPL < worstL.netPL) worstL = t;
    } else breakeven++;
  }
  const n = closed.length;
  const ref = (t) => (t ? { id: t.id, instrument: t.instrument, netPL: round2(t.netPL), date: calendarKey(t) } : null);
  return {
    n,
    winners,
    losers,
    breakeven,
    net: round2(net),
    winRate: n ? round1((winners / n) * 100) : null,
    grossWin: round2(grossWin),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
    avgWin: winners ? round2(grossWin / winners) : null,
    avgLoss: losers ? round2(-grossLoss / losers) : null,
    largestWin: ref(bestW),
    largestLoss: ref(worstL),
  };
}

// Group closed trades by a key. order (optional) fixes the row order; otherwise rows sort by net.
export function groupBy(trades, keyFn, order = null) {
  const map = new Map();
  for (const t of trades.filter(hasPL)) {
    const raw = keyFn(t);
    const k = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  const rows = [...map.entries()].map(([key, list]) => ({ key, ...summarize(list) }));
  if (order) {
    const pos = (k) => (order.indexOf(k) === -1 ? 99 : order.indexOf(k));
    rows.sort((a, b) => pos(a.key) - pos(b.key) || a.key.localeCompare(b.key));
  } else {
    rows.sort((a, b) => b.net - a.net || a.key.localeCompare(b.key));
  }
  return rows;
}

const byTime = (a, b) => (Date.parse(a.exitTime || a.entryTime) || 0) - (Date.parse(b.exitTime || b.entryTime) || 0)
  || String(a.id).localeCompare(String(b.id));

// Longest runs of wins and losses in time order. A break-even trade ends any run.
export function streaks(trades) {
  const seq = trades.filter(hasPL).sort(byTime);
  let bestW = 0, bestL = 0, run = 0, runType = null;
  for (const t of seq) {
    const c = classifyResult(t.netPL);
    if (c !== 'profit' && c !== 'loss') { run = 0; runType = null; continue; }
    if (c === runType) run++; else { runType = c; run = 1; }
    if (c === 'profit') bestW = Math.max(bestW, run); else bestL = Math.max(bestL, run);
  }
  return {
    longestWin: bestW,
    longestLoss: bestL,
    current: runType ? { type: runType === 'profit' ? 'win' : 'loss', length: run } : { type: null, length: 0 },
  };
}

// Net P/L per calendar day (closed trades only).
export function dailyPL(trades) {
  const days = {};
  for (const t of trades.filter(hasPL)) {
    const k = calendarKey(t);
    if (!k) continue;
    if (!days[k]) days[k] = { net: 0, n: 0 };
    days[k].net += t.netPL;
    days[k].n++;
  }
  return days;
}

// Consistency: share of profitable days and the spread of daily P/L (population std dev).
export function consistency(trades) {
  const entries = Object.entries(dailyPL(trades));
  const n = entries.length;
  if (!n) return { tradingDays: 0, profitDays: 0, lossDays: 0, beDays: 0, profitDayShare: null, meanDaily: null, stdDevDaily: null, bestDay: null, worstDay: null };
  const vals = entries.map(([, v]) => v.net);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  let profitDays = 0, lossDays = 0, beDays = 0, best = null, worst = null;
  for (const [date, v] of entries) {
    if (v.net > BE_EPS) profitDays++;
    else if (v.net < -BE_EPS) lossDays++;
    else beDays++;
    if (!best || v.net > best.net) best = { date, net: round2(v.net) };
    if (!worst || v.net < worst.net) worst = { date, net: round2(v.net) };
  }
  return {
    tradingDays: n,
    profitDays,
    lossDays,
    beDays,
    profitDayShare: round1((profitDays / n) * 100),
    meanDaily: round2(mean),
    stdDevDaily: round2(Math.sqrt(variance)),
    bestDay: best,
    worstDay: worst,
  };
}

// Full analytics snapshot for a date range. Every section uses the same filtered list.
export function analyticsSnapshot(trades, range = {}) {
  const from = range.from || '';
  const to = range.to || '';
  const list = filterAnalytics(trades, { from, to });
  const st = computeStats(list, { period: 'all' });
  return {
    range: { from, to },
    count: list.length,
    summary: summarize(list),
    direction: groupBy(list, (t) => t.direction, ['long', 'short']),
    symbol: groupBy(list, (t) => t.instrument),
    session: groupBy(list, (t) => t.session),
    strategy: groupBy(list, (t) => t.strategy),
    weekday: groupBy(list, (t) => weekdayName(t.entryTime), WEEKDAYS),
    streaks: streaks(list),
    consistency: consistency(list),
    drawdown: { abs: st.maxDrawdownAbs, pct: st.maxDrawdownPct },
    curve: st.curve,
    openCount: trades.filter((t) => t.status === 'open').length,
  };
}

// --- Calendar ----------------------------------------------------------------

export function dayStatus(e) {
  if (!e || (!e.closed && !e.open)) return 'none';
  if (!e.closed) return 'open';
  if (e.net > BE_EPS) return 'profit';
  if (e.net < -BE_EPS) return 'loss';
  return 'be';
}

export function shiftMonth(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// Month grid (weeks start Monday). Cells outside the month are blank.
export function monthGrid(year, month, trades, todayKey) {
  const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const byDay = new Map();
  for (const t of trades) {
    const k = calendarKey(t);
    if (!k || !k.startsWith(ym + '-')) continue;
    const e = byDay.get(k) || { net: 0, closed: 0, open: 0 };
    if (hasPL(t)) { e.net += t.netPL; e.closed++; } else if (t.status === 'open') e.open++;
    byDay.set(k, e);
  }
  const total = Math.ceil((firstDow + dim) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > dim) {
      cells.push({ key: null, day: null, inMonth: false, status: 'blank', net: 0, closed: 0, open: 0, isToday: false });
      continue;
    }
    const key = `${ym}-${String(dayNum).padStart(2, '0')}`;
    const e = byDay.get(key) || { net: 0, closed: 0, open: 0 };
    cells.push({ key, day: dayNum, inMonth: true, net: round2(e.net), closed: e.closed, open: e.open, status: dayStatus(e), isToday: key === todayKey });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const weekSummaries = weeks.map((w) => {
    const inM = w.filter((c) => c.inMonth);
    return {
      from: inM[0] ? inM[0].key : null,
      to: inM[inM.length - 1] ? inM[inM.length - 1].key : null,
      net: round2(inM.reduce((a, c) => a + c.net, 0)),
      closed: inM.reduce((a, c) => a + c.closed, 0),
      tradingDays: inM.filter((c) => c.closed > 0).length,
    };
  });
  const inMonth = cells.filter((c) => c.inMonth);
  const summary = {
    net: round2(inMonth.reduce((a, c) => a + c.net, 0)),
    closed: inMonth.reduce((a, c) => a + c.closed, 0),
    openCount: inMonth.reduce((a, c) => a + c.open, 0),
    tradingDays: inMonth.filter((c) => c.closed > 0).length,
    profitDays: inMonth.filter((c) => c.status === 'profit').length,
    lossDays: inMonth.filter((c) => c.status === 'loss').length,
    beDays: inMonth.filter((c) => c.status === 'be').length,
    noTradeDays: inMonth.filter((c) => c.status === 'none').length,
  };
  return { year, month, ym, weeks, weekSummaries, summary };
}

// Trades that belong to one calendar day, oldest first.
export function tradesOnDay(trades, key) {
  return trades
    .filter((t) => calendarKey(t) === key)
    .sort((a, b) => (Date.parse(a.entryTime) || 0) - (Date.parse(b.entryTime) || 0));
}

// --- Discipline (descriptive) -------------------------------------------------

const PLAN_VALUES = ['yes', 'partial', 'no'];
const PLAN_ORDER = ['yes', 'partial', 'no', 'unset'];
const planOf = (t) => (PLAN_VALUES.includes(t.planFollowed) ? t.planFollowed : 'unset');

// Split free text into normalised tags. Short fragments and duplicates within one note are dropped.
export function splitItems(text, pattern) {
  const parts = String(text || '').split(pattern).map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '));
  return [...new Set(parts.filter((s) => s.length >= 2 && s.length <= 40))];
}

const MISTAKE_SPLIT = /[,;\n]+/;
const EMOTION_SPLIT = /[,;/\n]+/;

function tally(trades, textOf, pattern) {
  const map = new Map();
  for (const t of trades) {
    const c = hasPL(t) ? classifyResult(t.netPL) : null;
    for (const tag of splitItems(textOf(t), pattern)) {
      const e = map.get(tag) || { tag, count: 0, onWinners: 0, onLosers: 0 };
      e.count++;
      if (c === 'profit') e.onWinners++;
      else if (c === 'loss') e.onLosers++;
      map.set(tag, e);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 10);
}

function violationOf(list) {
  const recorded = list.filter((t) => planOf(t) !== 'unset');
  const notFollowed = recorded.filter((t) => planOf(t) === 'partial' || planOf(t) === 'no');
  return {
    n: list.length,
    recorded: recorded.length,
    notFollowed: notFollowed.length,
    rate: recorded.length ? round1((notFollowed.length / recorded.length) * 100) : null,
  };
}

export function discipline(trades) {
  const closed = trades.filter(hasPL);
  const isWin = (t) => classifyResult(t.netPL) === 'profit';
  const isLoss = (t) => classifyResult(t.netPL) === 'loss';
  return {
    totalTrades: trades.length,
    planCounts: Object.fromEntries(PLAN_ORDER.map((p) => [p, trades.filter((t) => planOf(t) === p).length])),
    planOutcomes: PLAN_ORDER.map((p) => ({ plan: p, ...summarize(closed.filter((t) => planOf(t) === p)) })),
    violations: {
      winners: violationOf(closed.filter(isWin)),
      losers: violationOf(closed.filter(isLoss)),
      breakeven: violationOf(closed.filter((t) => !isWin(t) && !isLoss(t))),
    },
    mistakes: tally(trades, (t) => t.mistakes, MISTAKE_SPLIT),
    emotions: tally(trades, (t) => [t.emotionsBefore, t.emotionsDuring].filter(Boolean).join(', '), EMOTION_SPLIT),
    notes: {
      withMistakes: trades.filter((t) => splitItems(t.mistakes, MISTAKE_SPLIT).length > 0).length,
      withLessons: trades.filter((t) => String(t.lessons || '').trim()).length,
      withEmotions: trades.filter((t) => String(t.emotionsBefore || '').trim() || String(t.emotionsDuring || '').trim()).length,
    },
  };
}

// --- Daily reflections ------------------------------------------------------------

// Validate one day's reflection. At least one field must have text.
export function validateReflection(dateKey, raw = {}) {
  const errors = {};
  if (!isDayKey(dateKey)) errors.date = 'Pick a valid date.';
  const value = {};
  let filled = 0;
  for (const f of REFLECTION_FIELDS) {
    const s = String(raw[f.key] == null ? '' : raw[f.key]).trim();
    if (s.length > MAX_REFLECTION) errors[f.key] = `Max ${MAX_REFLECTION} characters.`;
    value[f.key] = s;
    if (s) filled++;
  }
  if (!Object.keys(errors).length && !filled) errors._form = "Write at least one line, or delete this day's entry.";
  return { valid: Object.keys(errors).length === 0, errors, value };
}

// Keep every well-formed entry from stored data. Invalid keys are dropped, text is never invented.
export function sanitizeReflections(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!isDayKey(k) || !v || typeof v !== 'object') continue;
    const entry = {};
    for (const f of REFLECTION_FIELDS) entry[f.key] = String(v[f.key] == null ? '' : v[f.key]).slice(0, MAX_REFLECTION);
    if (!REFLECTION_FIELDS.some((f) => entry[f.key].trim())) continue; // an empty day is not an entry
    entry.updatedAt = typeof v.updatedAt === 'string' ? v.updatedAt : null;
    out[k] = entry;
  }
  return out;
}
