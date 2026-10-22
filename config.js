// Central constants and default instrument specs for Zainul FX Journal.
// Pure data: no DOM access, safe to import from tests.

export const APP_NAME = 'Zainul FX Journal';
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'zainul-fx-journal:v1';

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
