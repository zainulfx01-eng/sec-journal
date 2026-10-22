Zainul FX Journal (Stage 2)
A Telegram Mini App for forex trade journaling. Dark charcoal and gold, light mode supported. Static HTML, CSS and JS with no build step. Data lives in this device's browser storage (localStorage). Supabase sync and Telegram-verified accounts arrive in Stage 3.
Deploy (GitHub Pages, flat)
Every file sits in the repository root. Do not create subfolders. Upload all the files listed below to the repo root, then enable GitHub Pages from the main branch root.
Run and test locally
Requires Node 18+ for tests. The app itself needs only a static file server.
npm test                       # runs all node:test suites (no dependencies)
python3 -m http.server 8080    # serve the app, then open http://localhost:8080
The app works in a plain browser (demo mode, data local to that browser). Inside Telegram it uses the Telegram WebApp SDK for theme, BackButton and MainButton.
Files (all flat, repository root)
index.html        app shell (header, view container, bottom nav, FAB)
styles.css        dark charcoal + gold theme, light theme, Stage 2 styles appended
app.js            boot, router, bottom navigation (5 tabs)
telegram.js       Telegram WebApp wrapper (theme, back/main buttons, safe initData handling)
ui.js             formatting, modal, toast, notices, download helper
config.js         constants, default instrument specs, schema version, Stage 2 caps
calc.js           pure P/L, pip, sizing and risk/reward math (no DOM)
trades.js         pure trade validation, normalisation, filter, sort, stats (no DOM)
csv.js            pure CSV parse, column mapping, validation, duplicate detection (no DOM)
storage.js        schema-versioned localStorage store (schema 2), reflections, screenshots, JSON backup
insights.js       pure analytics, calendar and discipline logic (no DOM)
shots.js          pure screenshot helpers and the browser-only JPEG compressor
chart.js          SVG equity curve
dashboard.js      dashboard view
journal.js        trade list, trade detail (with screenshots), add/edit form
analytics.js      analytics view: deep-dives, calendar and discipline sections
calendar.js       trading calendar: month grid, day drill-down, weekly and monthly summaries
discipline.js     discipline tracker and daily reflection journal
calculator.js     two-mode position and risk calculator
settings.js       settings, JSON backup export/import, wipe
logic.test.js     Stage 1 suite (calc, trades, storage)
io.test.js        Stage 1 suite (CSV and import)
stage2.test.js    Stage 2 suite (insights, reflections, screenshots, schema v2 migration)
package.json      test script only, no runtime dependencies
Stage 2 features
Analytics deep-dives with a date filter (all, this week, this month, last 30 days, custom): long vs short, by symbol, by session, by strategy, by weekday, average winner and loser, largest winner and loser, profit factor (shown as unavailable when there are no gross losses), max drawdown, win and loss streaks, and a consistency measure (share of profitable days and the standard deviation of daily P/L).
Trading calendar inside Analytics: a month grid of daily net P/L (green for a profit day, red for a loss day, gray for break-even, a neutral cell for no trades), month navigation, tap a day to see its trades, and weekly and monthly summaries. Days use Africa/Lagos (WAT).
Discipline tracker inside Analytics: plan followed vs not, most common mistakes, rule violations on winning vs losing trades, and emotion tag frequency. These are descriptive patterns in your own notes. They show what showed up together, not what caused wins or losses, and they do not predict or guarantee profitability.
Daily reflection journal: per date, what you did well, what you did poorly, your main lesson and what you will improve tomorrow. Editable, stored per date.
Per-trade screenshots: attach before and after images. Images are resized to at most 1280 px and compressed to JPEG quality 0.7 in the browser. Limits: up to 6 per trade, and a 4 MB total cap across the journal. A warning appears at 80 percent, and the app rejects new screenshots with a clear message at the cap. Screenshots are stored on this device only (localStorage) until Stage 3 moves them to Supabase.
Schema and migration
The schema is now version 2. Existing Stage 1 data migrates automatically on load: trades are kept as they are, the reflections map is added empty, and each trade gains an empty screenshots list. The storage key is unchanged, so no data is orphaned. Export a backup before updating if you want a safety copy.
Security notes
The client never trusts a user ID. Stage 1 and 2 read initData only for display.
Stage 3 must validate initData on the server: compute HMAC-SHA256 with the key derived from the bot token (secret key = HMAC("WebAppData", bot_token)), compare the hash field, and reject stale auth_date values.
All user-provided text is escaped before insertion into HTML.
Screenshot data is only accepted as JPEG data URLs created by the app's own compressor.
Never commit real values from .env. The bot token and Supabase service role key are server-only.
Money is an estimate
Pip size, contract size and tick value are configurable defaults, not broker data. Commission, swap and conversion rates vary by broker. Figures are labelled estimate in the UI. Net P/L is taken from your entry when you supply it, otherwise computed from gross minus costs.
Data safety
Local data can be lost if you clear browser storage or switch devices. Use Settings, Export backup regularly. Screenshots are the largest part of local storage, so export a backup before deleting many. Stage 3 adds cloud sync.
