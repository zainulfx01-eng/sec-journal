# Zainul FX Journal (Stage 1)

A Telegram Mini App for forex trade journaling. Dark charcoal and gold. Stage 1 is static HTML, CSS and JS with no build step. Data lives in this device's browser storage (localStorage). Supabase sync and Telegram-verified accounts arrive in Stage 3.

## Run locally

Requires Node 18+ for tests. The app itself needs only a static file server.

    cd zainul-fx-journal
    npm test                       # runs the logic test suite (no dependencies)
    python3 -m http.server 8080    # serve the app, then open http://localhost:8080

The app works in a plain browser (demo mode, data local to that browser). Inside Telegram it uses the Telegram WebApp SDK for theme, BackButton and MainButton.

## Folder structure

    index.html          app shell (header, view container, bottom nav, FAB)
    css/styles.css      dark charcoal + gold theme, light theme via data-theme="light"
    js/app.js           boot, router, bottom navigation
    js/telegram.js      Telegram WebApp wrapper (theme, back/main buttons, safe initData handling)
    js/ui.js            formatting, modal, toast, notices, CSV download helper
    js/config.js        constants and default instrument specs (estimates)
    js/calc.js          pure P/L, pip, sizing and risk/reward math (no DOM)
    js/trades.js        pure trade validation, normalisation, filter, sort, stats (no DOM)
    js/csv.js           pure CSV parse, column mapping, validation, duplicate detection (no DOM)
    js/storage.js       schema-versioned localStorage store + JSON backup export/import
    js/views/*.js       dashboard, journal, analytics, calculator, settings screens
    tests/logic.test.js node:test suite for calc, trades, csv and storage
    docs/               this file's companion docs (testing, deployment, Stage 1 scope)
    assets/             icons and the example CSV template
    .env.example        placeholders only, no real secrets
    package.json        test script only, no runtime dependencies

## Security notes

- The client never trusts a user ID. Stage 1 reads initData only for display.
- Stage 3 must validate initData on the server: compute HMAC-SHA256 with the key derived from the bot token (secret key = HMAC("WebAppData", bot_token)), compare the `hash` field, and reject stale `auth_date` values.
- All user-provided text is escaped before insertion into HTML.
- Never commit real values from .env. The bot token and Supabase service role key are server-only.

## Money is an estimate

Pip size, contract size and tick value are configurable defaults, not broker data. Commission, swap and conversion rates vary by broker. Figures are labelled estimate in the UI. Net P/L is taken from your entry when you supply it, otherwise computed from gross minus costs.

## Data safety

Local data can be lost if you clear browser storage or switch devices. Use Settings → Export backup regularly. Stage 3 adds cloud sync.
