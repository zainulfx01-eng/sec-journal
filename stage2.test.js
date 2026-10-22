// Stage 2 tests: insights (analytics, calendar, discipline), reflections, screenshots, schema v2 migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ins from './insights.js';
import { createStore, migrate, EMPTY_STATE } from './storage.js';
import { screenshotUsage, sanitizeShots, fitDimensions } from './shots.js';
import { SCHEMA_VERSION, SHOT_TOTAL_CAP_CHARS, SHOT_MAX_DIM } from './config.js';
import { validateTrade, normalizeTrade } from './trades.js';

// Helper: build a closed trade with an explicit exit day in WAT.
function T(over = {}) {
  const o = { ...over };
  // Accept the old names used in these tests and map them to the store's real names.
  if ('exitDate' in o) { o.exitTime = o.exitDate; delete o.exitDate; }
  if ('entryDate' in o) { o.entryTime = o.entryDate; delete o.entryDate; }
  const base = {
    instrument: 'XAUUSD', direction: 'long', lots: 1, status: 'closed',
    entryTime: '2026-10-05T12:00:00+01:00', exitTime: '2026-10-05T15:00:00+01:00',
    entryPrice: 2000, stopLoss: 1990, takeProfit: 2020, exitPrice: 2010,
    grossPL: 100, commission: 0, swap: 0, otherCosts: 0,
    session: 'New York', strategy: 'SMC', planFollowed: 'yes',
    mistakes: [], emotions: [], ruleViolations: [], lessons: '',
    screenshots: [],
  };
  // grossPL with zero costs gives netPL; open trades keep no P/L
  const merged = { ...base, ...o, id: o.id || Math.random().toString(36).slice(2) };
  if (merged.status === 'open') { merged.exitTime = null; merged.exitPrice = null; merged.grossPL = null; }
  return normalizeTrade(merged);
}

test('dayKey uses Africa/Lagos calendar (late UTC rolls to next WAT day)', () => {
  // 23:30 UTC on 4 Oct is 00:30 WAT on 5 Oct
  assert.equal(ins.dayKey('2026-10-04T23:30:00Z'), '2026-10-05');
  assert.equal(ins.dayKey('2026-10-05T10:00:00+01:00'), '2026-10-05');
  assert.equal(ins.dayKey(null), null);
  assert.equal(ins.dayKey('nonsense'), null);
});

test('isDayKey accepts only real YYYY-MM-DD dates', () => {
  assert.equal(ins.isDayKey('2026-02-28'), true);
  assert.equal(ins.isDayKey('2026-02-30'), false);
  assert.equal(ins.isDayKey('26-10-05'), false);
});

test('addDays and shiftMonth wrap across boundaries', () => {
  assert.equal(ins.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(ins.addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(ins.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(ins.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test('summarize: avg win/loss, largest win/loss, profit factor, n/a without losses', () => {
  const trades = [T({ grossPL: 100 }), T({ grossPL: 300 }), T({ grossPL: -50 }), T({ grossPL: -150 })];
  const s = ins.summarize(trades);
  assert.equal(s.n, 4);
  assert.equal(s.winners, 2);
  assert.equal(s.losers, 2);
  assert.equal(s.avgWin, 200);
  assert.equal(s.avgLoss, -100);
  assert.equal(s.largestWin.netPL, 300);
  assert.equal(s.largestLoss.netPL, -150);
  assert.equal(s.profitFactor, 2);
  const noLoss = ins.summarize([T({ grossPL: 100 })]);
  assert.equal(noLoss.profitFactor, null);
});

test('summarize: open trades and break-even are excluded from win/loss counts', () => {
  const trades = [T({ grossPL: 100 }), T({ grossPL: 0.001 }), T({ status: 'open', exitDate: null, exitPrice: null, grossPL: null })];
  const s = ins.summarize(trades);
  assert.equal(s.n, 2); // the open trade is excluded
  assert.equal(s.breakeven, 1);
  assert.equal(s.winners, 1);
});

test('groupBy by direction gives long vs short performance', () => {
  const trades = [T({ direction: 'long', grossPL: 100 }), T({ direction: 'long', grossPL: -40 }), T({ direction: 'short', grossPL: 50 })];
  const g = ins.groupBy(trades, (t) => t.direction, ['long', 'short']);
  const long = g.find((x) => x.key === 'long');
  const short = g.find((x) => x.key === 'short');
  assert.equal(long.n, 2);
  assert.equal(long.net, 60);
  assert.equal(short.net, 50);
});

test('weekday grouping uses WAT weekday, not UTC', () => {
  // 2026-10-05 is a Monday in WAT
  const t = T({ exitDate: '2026-10-05T10:00:00+01:00' });
  assert.equal(ins.weekdayName(t.exitTime), 'Mon');
});

test('dailyPL sums net by WAT day; streaks count consecutive wins and losses in order', () => {
  const trades = [
    T({ exitDate: '2026-10-05T10:00:00+01:00', grossPL: 100 }),
    T({ exitDate: '2026-10-05T15:00:00+01:00', grossPL: 50 }),
    T({ exitDate: '2026-10-06T10:00:00+01:00', grossPL: -30 }),
    T({ exitDate: '2026-10-07T10:00:00+01:00', grossPL: -20 }),
    T({ exitDate: '2026-10-08T10:00:00+01:00', grossPL: -10 }),
    T({ exitDate: '2026-10-09T10:00:00+01:00', grossPL: 70 }),
  ];
  const d = ins.dailyPL(trades);
  assert.equal(d['2026-10-05'].net, 150);
  const st = ins.streaks(trades);
  assert.equal(st.longestWin, 2);
  assert.equal(st.longestLoss, 3);
  assert.equal(st.current.type, 'win');
  assert.equal(st.current.length, 1);
});

test('consistency: share of profitable days and stdev of daily P/L', () => {
  const trades = [
    T({ exitDate: '2026-10-05T10:00:00+01:00', grossPL: 100 }),
    T({ exitDate: '2026-10-06T10:00:00+01:00', grossPL: -100 }),
    T({ exitDate: '2026-10-07T10:00:00+01:00', grossPL: 100 }),
    T({ exitDate: '2026-10-08T10:00:00+01:00', grossPL: 100 }),
  ];
  const c = ins.consistency(trades);
  assert.equal(c.tradingDays, 4);
  assert.equal(c.profitDays, 3);
  assert.equal(c.profitDayShare, 75);
  assert.ok(c.stdDevDaily > 0);
});

test('presetRange: week starts Monday, custom bounds are respected', () => {
  const today = '2026-10-22'; // Thursday
  const w = ins.presetRange('week', today);
  assert.equal(w.from, '2026-10-19');
  assert.equal(w.to, '2026-10-22');
  const m = ins.presetRange('month', today);
  assert.equal(m.from, '2026-10-01');
  const c = ins.presetRange('custom', today, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(c.from, '2026-09-01');
  assert.equal(c.to, '2026-09-30');
});

test('filterAnalytics applies the date filter on exit day (inclusive)', () => {
  const trades = [
    T({ exitDate: '2026-10-04T10:00:00+01:00', grossPL: 1 }),
    T({ exitDate: '2026-10-05T10:00:00+01:00', grossPL: 2 }),
    T({ exitDate: '2026-10-09T10:00:00+01:00', grossPL: 3 }),
  ];
  const f = ins.filterAnalytics(trades, { from: '2026-10-05', to: '2026-10-09' });
  assert.equal(f.length, 2);
});

test('analyticsSnapshot respects the date filter and returns deep-dive sections', () => {
  const trades = [
    T({ direction: 'long', exitDate: '2026-10-05T10:00:00+01:00', grossPL: 100, session: 'London', strategy: 'SMC' }),
    T({ direction: 'short', exitDate: '2026-10-06T10:00:00+01:00', grossPL: -40, session: 'New York', strategy: 'Breakout' }),
  ];
  const all = ins.analyticsSnapshot(trades, { from: '', to: '' });
  assert.equal(all.count, 2);
  const onlyLong = ins.analyticsSnapshot(trades, { from: '2026-10-05', to: '2026-10-05' });
  assert.equal(onlyLong.count, 1);
  assert.ok(all.session.find((x) => x.key === 'London'));
  assert.ok(all.strategy.find((x) => x.key === 'SMC'));
});

test('monthGrid: no-trade vs break-even vs profit vs loss statuses and open trades', () => {
  const trades = [
    T({ exitDate: '2026-10-05T10:00:00+01:00', grossPL: 100 }),
    T({ exitDate: '2026-10-06T10:00:00+01:00', grossPL: -50 }),
    T({ exitDate: '2026-10-07T10:00:00+01:00', grossPL: 0.001 }),
    T({ status: 'open', exitDate: null, exitPrice: null, grossPL: null, entryTime: '2026-10-08T10:00:00+01:00' }),
  ];
  const g = ins.monthGrid(2026, 10, trades, '2026-10-22');
  const byDay = {};
  for (const w of g.weeks) for (const c of w) if (c.inMonth) byDay[c.key] = c;
  assert.equal(byDay['2026-10-05'].status, 'profit');
  assert.equal(byDay['2026-10-06'].status, 'loss');
  assert.equal(byDay['2026-10-07'].status, 'be');
  assert.equal(byDay['2026-10-08'].status, 'open');
  assert.equal(byDay['2026-10-09'].status, 'none');
});

test('monthGrid: weekly and monthly totals only count closed trades', () => {
  const trades = [
    T({ exitDate: '2026-10-05T10:00:00+01:00', grossPL: 100 }),
    T({ exitDate: '2026-10-06T10:00:00+01:00', grossPL: -30 }),
  ];
  const g = ins.monthGrid(2026, 10, trades, '2026-10-22');
  assert.equal(g.summary.net, 70);
  assert.equal(g.summary.closed, 2);
});

test('tradesOnDay returns only trades whose exit day matches the key', () => {
  const trades = [T({ exitDate: '2026-10-05T10:00:00+01:00' }), T({ exitDate: '2026-10-06T10:00:00+01:00' })];
  assert.equal(ins.tradesOnDay(trades, '2026-10-05').length, 1);
});

test('splitItems splits a text list on commas, semicolons, and newlines and drops blanks', () => {
  assert.deepEqual(ins.splitItems('late entry; FOMO,\n  over-leveraged ', /[,;\n]+/), ['late entry', 'fomo', 'over-leveraged']);
});

test('discipline: plan followed vs not, and violations split by winners and losers', () => {
  const trades = [
    T({ planFollowed: 'yes', grossPL: 100 }),
    T({ planFollowed: 'no', grossPL: -50, mistakes: 'late entry', emotionsDuring: 'FOMO' }),
    T({ planFollowed: 'no', grossPL: 80, mistakes: 'late entry', emotionsDuring: 'FOMO' }),
    T({ planFollowed: 'partial', grossPL: -20, emotionsBefore: 'calm' }),
  ];
  const d = ins.discipline(trades);
  assert.equal(d.planCounts.yes, 1);
  assert.equal(d.planCounts.no, 2);
  assert.equal(d.planCounts.partial, 1);
  // winners: one trade (+80) with plan 'no'; losers: -50 (no) and -20 (partial)
  assert.equal(d.violations.winners.notFollowed, 1);
  assert.equal(d.violations.losers.notFollowed, 2);
  assert.equal(d.mistakes[0].tag, 'late entry');
  assert.equal(d.mistakes[0].count, 2);
  assert.equal(d.emotions[0].tag, 'fomo');
});

test('discipline wording stays descriptive, no causation claim', () => {
  assert.match(ins.DISCIPLINE_NOTE, /not what caused/i);
  assert.match(ins.DISCIPLINE_NOTE, /not predict|do not predict|does not predict|not .*guarantee/i);
});

test('validateReflection: requires a valid date and at least one field; rejects over-long text', () => {
  const ok = ins.validateReflection('2026-10-22', { did_well: 'stuck to the plan' });
  assert.equal(ok.valid, true);
  assert.equal(ins.validateReflection('2026-13-40', { did_well: 'x' }).valid, false);
  assert.equal(ins.validateReflection('2026-10-22', {}).valid, false);
  const big = ins.validateReflection('2026-10-22', { main_lesson: 'x'.repeat(1001) });
  assert.equal(big.valid, false);
});

test('sanitizeReflections drops malformed dates and empty entries', () => {
  const out = ins.sanitizeReflections({
    '2026-10-22': { did_well: 'good', updatedAt: '2026-10-22T10:00:00Z' },
    'bad-date': { did_well: 'x' },
    '2026-10-21': {},
    '2026-10-20': 'not an object',
  });
  assert.deepEqual(Object.keys(out), ['2026-10-22']);
});

test('screenshotUsage: totals, ratio, and warn/full levels at the cap', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(SHOT_TOTAL_CAP_CHARS * 0.85);
  const withShot = (dataUrl) => ({ ...T(), screenshots: [{ id: 'a', kind: 'before', dataUrl }] });
  const u = screenshotUsage([withShot(big)]);
  assert.equal(u.count, 1);
  assert.equal(u.level, 'warn');
  const full = screenshotUsage([withShot('data:image/jpeg;base64,' + 'A'.repeat(SHOT_TOTAL_CAP_CHARS))]);
  assert.equal(full.level, 'full');
  assert.equal(screenshotUsage([]).level, 'ok');
});

test('sanitizeShots keeps only jpeg data URLs with a valid kind', () => {
  const out = sanitizeShots([
    { id: '1', kind: 'before', dataUrl: 'data:image/jpeg;base64,AAAA' },
    { id: '2', kind: 'during', dataUrl: 'data:image/jpeg;base64,AAAA' },
    { id: '3', kind: 'after', dataUrl: 'javascript:alert(1)' },
    { id: '4', kind: 'after', dataUrl: 'data:image/png;base64,AAAA' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
});

test('fitDimensions caps the longest side at the max and never upscales', () => {
  const big = fitDimensions(4000, 3000, SHOT_MAX_DIM);
  assert.equal(big.width, 1280);
  assert.equal(big.height, 960);
  const small = fitDimensions(800, 600, SHOT_MAX_DIM);
  assert.equal(small.width, 800);
  assert.equal(small.height, 600);
});

test('schema v2 migration keeps every v1 trade and adds empty reflections and screenshots', () => {
  const v1 = {
    schemaVersion: 1,
    trades: [
      { id: 'old1', instrument: 'XAUUSD', direction: 'long', lots: 0.5, status: 'closed', entryTime: '2026-10-05T10:00:00+01:00', exitDate: '2026-10-05T12:00:00+01:00', entryPrice: 2000, stopLoss: 1990, exitPrice: 2005, grossPL: 50, commission: 0, swap: 0, otherCosts: 0 },
    ],
    settings: { accountCurrency: 'USD' },
  };
  const m = migrate(v1);
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.trades.length, 1);
  assert.equal(m.trades[0].id, 'old1');
  assert.equal(m.trades[0].grossPL, 50);
  assert.deepEqual(m.reflections, {});
});

test('store: add and delete a screenshot, and a reflection persists with updatedAt', () => {
  const mem = {};
  const storage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
  const store = createStore(storage);
  store.load();
  const r = store.upsertTrade({ instrument: 'XAUUSD', direction: 'long', lots: 1, status: 'open', entryTime: '2026-10-05T10:00:00+01:00', entryPrice: 2000, stopLoss: 1990 });
  assert.equal(r.ok, true);
  const tid = r.trade.id;
  const s = store.addScreenshot(tid, { kind: 'before', dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10 });
  assert.equal(s.ok, true);
  assert.equal(store.state.trades[0].screenshots.length, 1);
  const d = store.removeScreenshot(tid, store.state.trades[0].screenshots[0].id);
  assert.equal(d.ok, true);
  assert.equal(store.state.trades[0].screenshots.length, 0);
  const rf = store.setReflection('2026-10-22', { did_well: 'followed the plan' });
  assert.equal(rf.ok, true);
  assert.ok(store.state.reflections['2026-10-22'].updatedAt);
  assert.equal(store.deleteReflection('2026-10-22').ok, true);
});

test('store: adding a screenshot beyond the storage cap is rejected with a clear message', () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const store = createStore(storage);
  store.load();
  const r = store.upsertTrade({ instrument: 'XAUUSD', direction: 'long', lots: 1, status: 'open', entryTime: '2026-10-05T10:00:00+01:00', entryPrice: 2000, stopLoss: 1990 });
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(SHOT_TOTAL_CAP_CHARS);
  const res = store.addScreenshot(r.trade.id, { kind: 'before', dataUrl: huge });
  assert.equal(res.ok, false);
  assert.match(res.error, /storage cap|full|4 ?MB/i);
});
