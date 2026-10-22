// Calculation engine: instrument resolution, pip/point maths, P/L, risk-to-reward and position sizing.
// Every money figure from here is an ESTIMATE unless the trade's P/L was entered from the broker.
import { DEFAULT_INSTRUMENTS } from './config.js';

export const LOT_STEP = 0.01;
export const MIN_LOT = 0.01;
export const BE_EPS = 0.005; // amounts within half a cent are treated as break-even

export function normalizeSymbol(symbol) {
  return String(symbol ?? '')
    .toUpperCase()
    .replace(/[\s/_-]/g, '')
    .trim();
}

// Returns the spec used for a symbol: user overrides first, then built-in defaults.
export function resolveInstrument(symbol, customSpecs = {}) {
  const key = normalizeSymbol(symbol);
  if (!key) return { symbol: key, known: false, source: 'none' };
  const custom = customSpecs && customSpecs[key];
  const builtin = DEFAULT_INSTRUMENTS[key];
  const spec = custom || builtin;
  if (!spec) return { symbol: key, known: false, source: 'none' };
  return {
    symbol: key,
    known: true,
    source: custom ? 'custom' : 'default',
    pipSize: Number(spec.pipSize),
    contractSize: Number(spec.contractSize),
    quoteCurrency: String(spec.quoteCurrency || '').toUpperCase(),
  };
}

// Factor that converts one unit of the quote currency into the account currency.
// Returns null when a user-supplied conversion rate is needed but missing.
export function quoteToAccountFactor(symbol, quoteCurrency, accountCurrency, price, rate) {
  const acct = String(accountCurrency || '').toUpperCase();
  const quote = String(quoteCurrency || '').toUpperCase();
  const base = normalizeSymbol(symbol).slice(0, 3);
  if (!acct || !quote) return null;
  if (quote === acct) return 1;
  if (base === acct && price > 0) return 1 / price; // e.g. USDJPY on a USD account
  const r = Number(rate);
  return Number.isFinite(r) && r > 0 ? r : null;
}

// Money value of ONE pip for ONE lot in the account currency.
// Returns { pipValuePerLot, factor, needsRate } ; pipValuePerLot null if it cannot be computed.
export function pipValuePerLot({ spec, accountCurrency, price, rate }) {
  if (!spec || !spec.known) return { pipValuePerLot: null, factor: null, needsRate: false };
  const factor = quoteToAccountFactor(spec.symbol, spec.quoteCurrency, accountCurrency, price, rate);
  if (factor === null) return { pipValuePerLot: null, factor: null, needsRate: true };
  return { pipValuePerLot: spec.pipSize * spec.contractSize * factor, factor, needsRate: false };
}

// Price distance expressed in pips (always positive).
export function distanceInPips(a, b, pipSize) {
  if (!(pipSize > 0)) return null;
  return Math.abs(Number(a) - Number(b)) / pipSize;
}

// Signed pips a trade moved in its favour (positive = profit direction).
export function tradePips({ entryPrice, exitPrice, direction, pipSize }) {
  if (!(pipSize > 0) || exitPrice == null || entryPrice == null) return null;
  const sign = direction === 'short' ? -1 : 1;
  return ((Number(exitPrice) - Number(entryPrice)) * sign) / pipSize;
}

// Net P/L: broker gross, minus costs (commission and other costs are treated as positive costs
// whichever sign the broker uses), plus swap (signed).
export function computeNetPL({ grossPL, commission, swap, otherCosts }) {
  if (grossPL == null || grossPL === '') return null;
  const g = Number(grossPL);
  const c = Math.abs(Number(commission || 0));
  const s = Number(swap || 0);
  const o = Math.abs(Number(otherCosts || 0));
  return round2(g - c + s - o);
}

// Planned RR from prices: reward distance / risk distance.
export function plannedRRFromPrices({ entryPrice, stopLoss, takeProfit }) {
  if (!(entryPrice > 0) || !(stopLoss > 0) || !(takeProfit > 0)) return null;
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  if (risk === 0) return null;
  return round2(reward / risk);
}

// Realised R-multiple: net P/L divided by the initial monetary risk.
export function realizedR({ netPL, initialRisk }) {
  if (netPL == null || !(Number(initialRisk) > 0)) return null;
  return round3(Number(netPL) / Number(initialRisk));
}

// Classify a closed trade's result.
export function classifyResult(netPL) {
  if (netPL == null || Number.isNaN(Number(netPL))) return 'unknown';
  const n = Number(netPL);
  if (n > BE_EPS) return 'profit';
  if (n < -BE_EPS) return 'loss';
  return 'breakeven';
}

// Risk / reward calculator, mode 1: trade planning.
// Input: { symbol, accountCurrency, direction, entry, stopLoss, takeProfit?, lots, rate?, commissionPerLot?, customSpecs? }
export function planTrade(input, customSpecs = {}) {
  const errors = [];
  const warnings = [];
  const spec = resolveInstrument(input.symbol, customSpecs);
  const entry = toNum(input.entry);
  const sl = toNum(input.stopLoss);
  const tp = input.takeProfit === '' || input.takeProfit == null ? null : toNum(input.takeProfit);
  const lots = toNum(input.lots);
  const direction = input.direction;

  if (!spec.known) errors.push(`Unknown instrument "${spec.symbol || '?'}". Add its specs in Settings → Instruments.`);
  if (!['long', 'short'].includes(direction)) errors.push('Choose long or short.');
  if (!(entry > 0)) errors.push('Entry price must be greater than 0.');
  if (!(sl > 0)) errors.push('Stop loss must be greater than 0.');
  if (!(lots > 0)) errors.push('Lots must be greater than 0.');
  if (lots > 1000) errors.push('Lots looks too large (max 1000).');
  if (entry > 0 && sl > 0 && entry === sl) errors.push('Stop loss cannot equal entry (zero risk distance).');
  if (entry > 0 && sl > 0 && direction) {
    if (direction === 'long' && !(sl < entry)) errors.push('For a long, stop loss must be below entry.');
    if (direction === 'short' && !(sl > entry)) errors.push('For a short, stop loss must be above entry.');
  }
  if (tp != null) {
    if (!(tp > 0)) errors.push('Take profit must be greater than 0 when provided.');
    else if (entry > 0 && tp === entry) errors.push('Take profit cannot equal entry.');
    else if (direction === 'long' && entry > 0 && !(tp > entry)) errors.push('For a long, take profit must be above entry.');
    else if (direction === 'short' && entry > 0 && !(tp < entry)) errors.push('For a short, take profit must be below entry.');
  }
  if (errors.length) return { ok: false, errors, warnings, estimate: true };

  const { pipValuePerLot: pv, needsRate } = pipValuePerLot({ spec, accountCurrency: input.accountCurrency, price: entry, rate: input.rate });
  if (needsRate) errors.push(`Enter a conversion rate: 1 ${spec.quoteCurrency} in ${input.accountCurrency} (needed for this pair).`);
  if (!needsRate && pv == null) errors.push('Enter an account currency to compute money values.');
  if (errors.length) return { ok: false, errors, warnings, estimate: true };

  const slPips = distanceInPips(entry, sl, spec.pipSize);
  const tpPips = tp != null ? distanceInPips(entry, tp, spec.pipSize) : null;
  const riskMoney = slPips * pv * lots;
  const rewardMoney = tpPips != null ? tpPips * pv * lots : null;
  const estCommission = toNum(input.commissionPerLot || 0) * lots;
  const rr = rewardMoney != null && riskMoney > 0 ? round2(rewardMoney / riskMoney) : null;
  if (spec.source === 'default') warnings.push('Using built-in default specs for this instrument. Check your broker and adjust in Settings.');
  if (tp == null) warnings.push('No take profit entered: reward and RR not computed.');

  return {
    ok: true,
    estimate: true,
    errors,
    warnings,
    result: {
      symbol: spec.symbol,
      pipSize: spec.pipSize,
      pipValuePerLot: round2(pv),
      slPips: round1(slPips),
      tpPips: tpPips == null ? null : round1(tpPips),
      riskMoney: round2(riskMoney),
      rewardMoney: rewardMoney == null ? null : round2(rewardMoney),
      estCommission: round2(estCommission),
      totalRiskWithCosts: round2(riskMoney + estCommission),
      plannedRR: rr,
    },
  };
}

// Risk / reward calculator, mode 2: position sizing.
// Input: { balance, riskPercent, symbol, accountCurrency, entry, stopLoss, takeProfit?, rate?, customSpecs? }
export function sizePosition(input, customSpecs = {}) {
  const errors = [];
  const warnings = [];
  const spec = resolveInstrument(input.symbol, customSpecs);
  const balance = toNum(input.balance);
  const riskPct = toNum(input.riskPercent);
  const entry = toNum(input.entry);
  const sl = toNum(input.stopLoss);
  const tp = input.takeProfit === '' || input.takeProfit == null ? null : toNum(input.takeProfit);

  if (!spec.known) errors.push(`Unknown instrument "${spec.symbol || '?'}". Add its specs in Settings → Instruments.`);
  if (!(balance > 0)) errors.push('Balance must be greater than 0.');
  if (!(riskPct > 0 && riskPct <= 100)) errors.push('Risk % must be above 0 and at most 100.');
  if (!(entry > 0)) errors.push('Entry price must be greater than 0.');
  if (!(sl > 0)) errors.push('Stop loss must be greater than 0.');
  if (entry > 0 && sl > 0 && entry === sl) errors.push('Stop loss cannot equal entry (zero risk distance).');
  if (tp != null && !(tp > 0)) errors.push('Take profit must be greater than 0 when provided.');
  if (errors.length) return { ok: false, errors, warnings, estimate: true };

  const direction = sl < entry ? 'long' : 'short';
  if (tp != null && tp === entry) errors.push('Take profit cannot equal entry.');
  if (tp != null && ((direction === 'long' && tp < entry) || (direction === 'short' && tp > entry))) {
    errors.push(`Take profit is on the wrong side for a ${direction} (stop loss implies ${direction}).`);
  }
  const { pipValuePerLot: pv, needsRate } = pipValuePerLot({ spec, accountCurrency: input.accountCurrency, price: entry, rate: input.rate });
  if (needsRate) errors.push(`Enter a conversion rate: 1 ${spec.quoteCurrency} in ${input.accountCurrency} (needed for this pair).`);
  if (!needsRate && pv == null) errors.push('Enter an account currency to compute money values.');
  if (errors.length) return { ok: false, errors, warnings, estimate: true };

  const slPips = distanceInPips(entry, sl, spec.pipSize);
  const tpPips = tp != null ? distanceInPips(entry, tp, spec.pipSize) : null;
  const riskAmount = balance * (riskPct / 100);
  const rawLots = riskAmount / (slPips * pv);
  const lots = Math.floor(rawLots / LOT_STEP + 1e-9) * LOT_STEP;
  if (lots < MIN_LOT) {
    warnings.push(`Risk of ${round2(riskAmount)} is too small for the minimum lot (${MIN_LOT}). Widen the risk % or tighten the stop.`);
  }
  const usedLots = Math.max(lots, 0);
  const actualRisk = usedLots * slPips * pv;
  const rewardMoney = tpPips != null ? usedLots * tpPips * pv : null;
  if (spec.source === 'default') warnings.push('Using built-in default specs for this instrument. Check your broker and adjust in Settings.');

  return {
    ok: usedLots >= MIN_LOT,
    estimate: true,
    errors: usedLots >= MIN_LOT ? [] : ['Position size is below the minimum lot for this risk.'],
    warnings,
    result: {
      direction,
      symbol: spec.symbol,
      riskAmount: round2(riskAmount),
      slPips: round1(slPips),
      tpPips: tpPips == null ? null : round1(tpPips),
      pipValuePerLot: round2(pv),
      rawLots: round3(rawLots),
      suggestedLots: round2(usedLots),
      actualRisk: round2(actualRisk),
      rewardMoney: rewardMoney == null ? null : round2(rewardMoney),
      plannedRR: rewardMoney != null && actualRisk > 0 ? round2(rewardMoney / actualRisk) : null,
    },
  };
}

function toNum(v) {
  if (v === '' || v == null) return NaN;
  return Number(v);
}
export function round1(n) { return n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10; }
export function round2(n) { return n == null || Number.isNaN(n) ? null : Math.round((n + Number.EPSILON) * 100) / 100; }
export function round3(n) { return n == null || Number.isNaN(n) ? null : Math.round(n * 1000) / 1000; }
