// Central constants and default instrument specs for Zainul FX Journal.
// Pure data: no DOM access, safe to import from tests.

export const APP_NAME = 'Zainul FX Journal';
// Schema 2 (Stage 2): adds trade.screenshots[] and the reflections map. Migration is additive.
// The storage key stays the same so existing Stage 1 data is never orphaned.
export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'zainul-fx-journal:v1';

// Journal calendar and analytics use this timezone for day boundaries (Nigeria, WAT, UTC+1, no DST).
export const APP_TIMEZONE = 'Africa/Lagos';

// Daily reflection fields, in display order. Stored per date (YYYY-MM-DD).
export const REFLECTION_FIELDS = [
  { key: 'did_well', label: 'What I did well' },
  { key: 'did_poorly', label: 'What I did poorly' },
  { key: 'main_lesson', label: 'Main lesson' },
  { key: 'improve_tomorrow', label: 'What I will improve tomorrow' },
];
export const MAX_REFLECTION = 1000;

// Screenshot attachments: stored as compressed JPEG data URLs INSIDE localStorage (local-only until Stage 3).
export const SHOT_KINDS = ['before', 'after'];
export const SHOT_MAX_DIM = 1280;          // longest side in pixels after resize
export const SHOT_JPEG_QUALITY = 0.7;
export const SHOT_MAX_PER_TRADE = 6;
export const SHOT_TOTAL_CAP_CHARS = 4 * 1024 * 1024; // hard cap on total screenshot data across the journal
export const SHOT_WARN_RATIO = 0.8;        // warn once usage reaches 80% of the cap

export const DIRECTIONS = ['long', 'short'];
export const STATUSES = ['open', 'closed'];
export const PLAN_VALUES = ['yes', 'partial', 'no'];
export const SESSIONS = ['Asia', 'London', 'New York', 'London/NY overlap', 'Other'];

export const MAX_TEXT = 2000;
export const MAX_SHORT_TEXT = 80;
export const MAX_LOTS = 1000;

// Default instrument specs. These are ESTIMATES. Brokers differ (point size,
// contract size, commission and currency conventions). Verify against your
// broker's specification and override in Settings.
//   pipSize:      price move that counts as one pip
//   contractSize: units per 1.00 lot
//   quoteCurrency: currency the price is quoted in (P/L is booked in account currency)
export const DEFAULT_INSTRUMENTS = {
  EURUSD: { pipSize: 0.0001, contractSize: 100000, quoteCurrency: 'USD', label: 'Euro / US Dollar' },
  GBPUSD: { pipSize: 0.0001, contractSize: 100000, quoteCurrency: 'USD', label: 'British Pound / US Dollar' },
  USDJPY: { pipSize: 0.01, contractSize: 100000, quoteCurrency: 'JPY', label: 'US Dollar / Japanese Yen' },
  GBPJPY: { pipSize: 0.01, contractSize: 100000, quoteCurrency: 'JPY', label: 'British Pound / Japanese Yen' },
  AUDUSD: { pipSize: 0.0001, contractSize: 100000, quoteCurrency: 'USD', label: 'Australian Dollar / US Dollar' },
  USDCAD: { pipSize: 0.0001, contractSize: 100000, quoteCurrency: 'CAD', label: 'US Dollar / Canadian Dollar' },
  XAUUSD: { pipSize: 0.1, contractSize: 100, quoteCurrency: 'USD', label: 'Gold / US Dollar (1 pip = $0.10 move, 100 oz/lot)' },
  BTCUSD: { pipSize: 1, contractSize: 1, quoteCurrency: 'USD', label: 'Bitcoin / US Dollar (1 pip = $1 move, 1 BTC/lot)' },
};

// Canonical trade fields. Used by forms, CSV import/export and backups.
// type: text | number | signed | datetime | enum
export const TRADE_FIELDS = [
  { key: 'accountName', label: 'Account name', type: 'text' },
  { key: 'instrument', label: 'Instrument', type: 'text', required: true },
  { key: 'direction', label: 'Direction', type: 'enum', required: true, values: DIRECTIONS },
  { key: 'status', label: 'Status', type: 'enum', values: STATUSES },
  { key: 'entryTime', label: 'Entry time', type: 'datetime', required: true },
  { key: 'exitTime', label: 'Exit time', type: 'datetime' },
  { key: 'entryPrice', label: 'Entry price', type: 'number', required: true },
  { key: 'exitPrice', label: 'Exit price', type: 'number' },
  { key: 'stopLoss', label: 'Stop loss', type: 'number' },
  { key: 'takeProfit', label: 'Take profit', type: 'number' },
  { key: 'lots', label: 'Lots', type: 'number', required: true },
  { key: 'accountCurrency', label: 'Account currency', type: 'text' },
  { key: 'initialRisk', label: 'Initial risk (amount)', type: 'number' },
  { key: 'grossPL', label: 'Gross P/L', type: 'signed' },
  { key: 'commission', label: 'Commission', type: 'number' },
  { key: 'swap', label: 'Swap', type: 'signed' },
  { key: 'otherCosts', label: 'Other costs', type: 'number' },
  { key: 'netPL', label: 'Net P/L', type: 'signed' },
  { key: 'plannedRR', label: 'Planned RR', type: 'number' },
  { key: 'session', label: 'Session', type: 'text' },
  { key: 'strategy', label: 'Strategy', type: 'text' },
  { key: 'entryReason', label: 'Entry reason', type: 'text' },
  { key: 'exitReason', label: 'Exit reason', type: 'text' },
  { key: 'emotionsBefore', label: 'Emotions before', type: 'text' },
  { key: 'emotionsDuring', label: 'Emotions during', type: 'text' },
  { key: 'planFollowed', label: 'Plan followed', type: 'enum', values: PLAN_VALUES },
  { key: 'mistakes', label: 'Mistakes', type: 'text' },
  { key: 'lessons', label: 'Lessons', type: 'text' },
];
