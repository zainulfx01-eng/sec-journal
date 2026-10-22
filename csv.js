// CSV parsing, column mapping, row validation, duplicate detection and export.
import { TRADE_FIELDS } from './config.js';
import { validateTrade, tradeFingerprint, normalizeTrade } from './trades.js';

// RFC 4180-ish parser: quoted fields, escaped quotes, CRLF/LF, BOM, embedded newlines.
export function parseCSV(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore, handled by \n */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (inQuotes) throw new Error('CSV has an unclosed quoted field.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Canonical header aliases so common exports map automatically.
const ALIASES = {
  accountName: ['account', 'account name', 'account_name', 'accountname'],
  instrument: ['symbol', 'instrument', 'pair', 'market', 'asset'],
  direction: ['direction', 'side', 'type', 'buy/sell', 'action'],
  status: ['status', 'state'],
  entryTime: ['entry time', 'entry_time', 'open time', 'opentime', 'open_time', 'entry date', 'open date', 'time', 'date'],
  exitTime: ['exit time', 'exit_time', 'close time', 'closetime', 'close_time', 'exit date', 'close date'],
  entryPrice: ['entry price', 'entry_price', 'open price', 'openprice', 'entry', 'price'],
  exitPrice: ['exit price', 'exit_price', 'close price', 'closeprice', 'exit', 'close'],
  stopLoss: ['stop loss', 'stop_loss', 'sl', 'stoploss'],
  takeProfit: ['take profit', 'take_profit', 'tp', 'takeprofit'],
  lots: ['lots', 'lot', 'volume', 'size', 'qty'],
  accountCurrency: ['account currency', 'currency', 'account_currency'],
  initialRisk: ['initial risk', 'risk', 'risk amount', 'initial_risk'],
  grossPL: ['gross pl', 'gross p/l', 'gross_pl', 'gross profit', 'profit', 'gross'],
  commission: ['commission', 'commissions', 'comm'],
  swap: ['swap', 'swaps'],
  otherCosts: ['other costs', 'other_costs', 'fees', 'other fees'],
  netPL: ['net pl', 'net p/l', 'net_pl', 'net profit', 'pnl', 'p/l', 'net'],
  plannedRR: ['planned rr', 'planned_rr', 'rr'],
  session: ['session'],
  strategy: ['strategy', 'setup'],
  entryReason: ['entry reason', 'entry_reason', 'reason'],
  exitReason: ['exit reason', 'exit_reason'],
  emotionsBefore: ['emotions before', 'emotions_before'],
  emotionsDuring: ['emotions during', 'emotions_during'],
  planFollowed: ['plan followed', 'plan_followed'],
  mistakes: ['mistakes'],
  lessons: ['lessons', 'lesson'],
};

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Auto-map headers to canonical field keys. Returns { mapping: { fieldKey: columnIndex }, unmapped: [headerIdx] }
export function autoMap(headers) {
  const mapping = {};
  const used = new Set();
  const normHeaders = headers.map(norm);
  for (const f of TRADE_FIELDS) {
    const candidates = [f.key.toLowerCase(), f.label.toLowerCase(), ...(ALIASES[f.key] || [])].map(norm);
    const idx = normHeaders.findIndex((h, i) => !used.has(i) && candidates.includes(h));
    if (idx >= 0) { mapping[f.key] = idx; used.add(idx); }
  }
  const unmapped = headers.map((_, i) => i).filter((i) => !used.has(i));
  return { mapping, unmapped };
}

export const REQUIRED_KEYS = TRADE_FIELDS.filter((f) => f.required).map((f) => f.key);

// Build a raw trade object from a CSV row and a mapping.
export function rowToRaw(row, mapping) {
  const raw = {};
  for (const [key, idx] of Object.entries(mapping)) {
    if (idx == null || idx < 0) continue;
    raw[key] = row[idx] ?? '';
  }
  // Direction synonyms: buy/sell, long/short
  if (raw.direction) {
    const d = String(raw.direction).trim().toLowerCase();
    if (['buy', 'b'].includes(d)) raw.direction = 'long';
    else if (['sell', 's'].includes(d)) raw.direction = 'short';
  }
  return raw;
}

// Full import analysis. existingTrades is used for duplicate detection.
// Returns { headers, mapping, missingRequired, rows: [{ line, status: 'valid'|'invalid'|'duplicate', errors, trade, raw }], counts }
export function analyzeImport(text, { mapping: customMapping, existingTrades = [] } = {}) {
  const table = parseCSV(text);
  if (table.length < 2) {
    return { headers: table[0] || [], mapping: {}, missingRequired: REQUIRED_KEYS, rows: [], counts: { total: 0, valid: 0, invalid: 0, duplicate: 0 }, error: 'The file needs a header row and at least one data row.' };
  }
  const headers = table[0];
  const auto = autoMap(headers);
  const mapping = customMapping ? { ...customMapping } : auto.mapping;
  const missingRequired = REQUIRED_KEYS.filter((k) => mapping[k] == null || mapping[k] < 0);
  if (missingRequired.length) {
    return { headers, mapping, missingRequired, rows: [], counts: { total: 0, valid: 0, invalid: 0, duplicate: 0 }, error: `Map the required columns: ${missingRequired.join(', ')}` };
  }
  const existingFp = new Set(existingTrades.map((t) => tradeFingerprint(normalizeTrade(t))));
  const seenInFile = new Set();
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const raw = rowToRaw(table[i], mapping);
    const { valid, errors, trade } = validateTrade(raw);
    const fp = valid ? tradeFingerprint(trade) : null;
    let status = valid ? 'valid' : 'invalid';
    const notes = [];
    if (valid && (existingFp.has(fp) || seenInFile.has(fp))) {
      status = 'duplicate';
      notes.push(existingFp.has(fp) ? 'Already in journal (same instrument, direction, entry time, price, lots and account).' : 'Repeated within this file.');
    }
    if (valid) seenInFile.add(fp);
    rows.push({ line: i + 1, status, errors: Object.entries(errors).map(([k, m]) => `${k}: ${m}`), notes, trade: valid ? trade : null, raw });
  }
  const counts = {
    total: rows.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
  };
  return { headers, mapping, missingRequired: [], rows, counts, error: null };
}

const EXPORT_COLUMNS = TRADE_FIELDS.map((f) => f.key).concat(['id', 'realizedR', 'result', 'createdAt', 'updatedAt']);

function csvCell(v) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '';
  const s = typeof v === 'number' ? String(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export trades as CSV text. Times are written as ISO UTC so re-import is lossless.
export function tradesToCSV(trades) {
  const header = EXPORT_COLUMNS.join(',');
  const lines = trades.map((t) => EXPORT_COLUMNS.map((k) => csvCell(t[k])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

export function exampleCSV() {
  return [
    'Account Name,Symbol,Direction,Status,Entry Time,Exit Time,Entry Price,Exit Price,Stop Loss,Take Profit,Lots,Account Currency,Initial Risk,Gross P/L,Commission,Swap,Other Costs,Session,Strategy,Plan Followed,Mistakes,Lessons',
    'Main Live,EURUSD,long,closed,2026-10-05T08:30,2026-10-05T11:10,1.08500,1.09100,1.08200,1.09800,0.50,USD,50,300,3.50,0,0,London,Breakout retest,yes,,Patience paid',
    'Main Live,GBPJPY,short,closed,2026-10-06T13:05,2026-10-06T14:40,190.500,190.950,191.200,189.800,0.30,USD,40,-135,2.10,-1.20,0,New York,Trend pullback,partial,Moved stop too early,Trust the level',
    'Main Live,XAUUSD,long,open,2026-10-20T09:15,,2330.00,,2320.00,2350.00,0.10,USD,30,,,,,London,Range fade,yes,,',
    'Main Live,USDJPY,long,closed,2026-10-07T07:00,2026-10-07T07:00,150.20,150.20,149.90,150.80,0.20,USD,20,0,0,0,0,Asia,Range fade,no,,Break-even exit',
  ].join('\r\n') + '\r\n';
}
