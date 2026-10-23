// Settings: account currency, starting balance, instrument specs, CSV import/export, JSON backup.
import { esc, toast, download, openModal, confirmDialog, showNotice } from './ui.js';
import { DEFAULT_INSTRUMENTS } from './config.js';
import { analyzeImport, tradesToCSV, exampleCSV } from './csv.js';
import { renderAccountCard } from './account.js';

export function renderSettings(view, ctx) {
  const s = ctx.store.state.settings;
  const cur = s.accountCurrency || 'USD';
  const custom = s.customInstruments || {};
  const count = ctx.store.state.trades.length;

  view.innerHTML = `
    <h1>Settings</h1>
    <div class="notice">Your journal is always saved on this device first. With an account, it also syncs to the cloud. Export a backup before clearing browser data.</div>
    <div class="card">
      <h3>Account</h3>
      <div class="grid2">
        <div class="field"><label>Account currency</label><input id="s-cur" maxlength="3" value="${esc(cur)}"/></div>
        <div class="field"><label>Starting balance (optional)</label><input id="s-bal" inputmode="decimal" value="${esc(s.startingBalance ?? '')}"/></div>
      </div>
      <button class="btn primary" id="s-save">Save settings</button>
    </div>
    <div class="card">
      <h3>Instrument specs</h3>
      <p class="small muted">Defaults are estimates. Set pip size, contract size and quote currency to match your broker.</p>
      <div id="inst-list">${[...Object.values(DEFAULT_INSTRUMENTS), ...Object.values(custom)].map((d) => `<div class="line"><span>${esc(d.symbol)}</span><span class="muted small">pip ${d.pipSize}, size ${d.contractSize}, ${esc(d.quoteCurrency)}${custom[d.symbol] ? ' (custom)' : ''}</span></div>`).join('')}</div>
      <button class="btn" id="inst-add">Add or override instrument</button>
    </div>
    <div class="card">
      <h3>Import and export</h3>
      <p class="small muted">${count} trade${count === 1 ? '' : 's'} saved on this device.</p>
      <div class="row">
        <button class="btn" id="exp-all">Export all CSV</button>
        <button class="btn" id="exp-tpl">Example CSV</button>
      </div>
      <div class="field" style="margin-top:12px"><label>Import CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv"/></div>
      <div id="csv-map"></div>
    </div>
    <div class="card">
      <h3>Backup (JSON)</h3>
      <div class="row"><button class="btn" id="bk-exp">Export backup</button><label class="btn ghost" style="cursor:pointer">Restore backup<input type="file" id="bk-file" accept=".json,application/json" hidden/></label></div>
      <p class="small muted">Restoring replaces all current data after you confirm.</p>
    </div>
    <div class="card">
      <h3>Danger zone</h3>
      <button class="btn danger" id="wipe">Delete all local data</button>
    </div>`;

  if (ctx.cloud) renderAccountCard(view, ctx.cloud, { onChange: () => ctx.rerender && ctx.rerender() });

  view.querySelector('#s-save').addEventListener('click', () => {
    const cur2 = view.querySelector('#s-cur').value.trim().toUpperCase();
    const bal = view.querySelector('#s-bal').value.trim();
    if (!/^[A-Z]{3}$/.test(cur2)) return toast('Currency must be a 3 letter code, e.g. USD.');
    const bn = bal === '' ? null : Number(bal);
    if (bn != null && (!Number.isFinite(bn) || bn < 0)) return toast('Starting balance must be a number of 0 or more.');
    ctx.store.updateSettings({ accountCurrency: cur2, startingBalance: bn });
    toast('Settings saved');
  });

  view.querySelector('#inst-add').addEventListener('click', () => openInstrumentForm(ctx));

  view.querySelector('#exp-all').addEventListener('click', () => {
    download(`zainul-fx-trades-${new Date().toISOString().slice(0, 10)}.csv`, tradesToCSV(ctx.store.state.trades), 'text/csv');
  });
  view.querySelector('#exp-tpl').addEventListener('click', () => download('zainul-fx-example.csv', exampleCSV(), 'text/csv'));

  view.querySelector('#csv-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('CSV is larger than 2 MB. Split it and import in parts.');
    const text = await file.text();
    showImportPreview(ctx, text);
  });

  view.querySelector('#bk-exp').addEventListener('click', () => {
    download(`zainul-fx-backup-${new Date().toISOString().slice(0, 10)}.json`, ctx.store.exportBackup(), 'application/json');
  });
  view.querySelector('#bk-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const ok = await confirmDialog('Restore backup?', 'This replaces all trades and settings currently on this device with the backup. Continue?', 'Restore');
    if (!ok) return;
    const r = ctx.store.importBackup(text);
    if (!r.ok) return showNotice(r.error, 'error');
    toast(`Backup restored (${r.count} trades)`);
    ctx.rerender();
  });

  view.querySelector('#wipe').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete all local data?', 'This removes every trade and setting from this device. Export a backup first if you might need it.', 'Delete everything');
    if (ok) { ctx.store.clearAll(); toast('Local data cleared'); ctx.rerender(); }
  });
}

function openInstrumentForm(ctx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="grid2">
    <div class="field"><label>Symbol</label><input id="i-sym" placeholder="e.g. EURUSD"/></div>
    <div class="field"><label>Pip size</label><input id="i-pip" inputmode="decimal" placeholder="0.0001"/></div>
    <div class="field"><label>Contract size</label><input id="i-size" inputmode="decimal" placeholder="100000"/></div>
    <div class="field"><label>Quote currency</label><input id="i-q" maxlength="3" placeholder="USD"/></div>
  </div><p class="small muted">Saved as your custom override for this symbol.</p>`;
  openModal({
    title: 'Instrument spec',
    body: wrap,
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: (c) => c() },
      { label: 'Save', kind: 'primary', onClick: (c) => {
        const sym = wrap.querySelector('#i-sym').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pip = Number(wrap.querySelector('#i-pip').value);
        const size = Number(wrap.querySelector('#i-size').value);
        const q = wrap.querySelector('#i-q').value.trim().toUpperCase();
        if (!sym) return toast('Symbol is required.');
        if (!(pip > 0) || !(size > 0) || !/^[A-Z]{3}$/.test(q)) return toast('Pip size, contract size (both above 0) and a 3 letter quote currency are required.');
        ctx.store.updateSettings({ customInstruments: { ...(ctx.store.state.settings.customInstruments || {}), [sym]: { symbol: sym, pipSize: pip, contractSize: size, quoteCurrency: q, source: 'custom', known: true } } });
        c();
        toast('Instrument saved');
        ctx.rerender();
      } },
    ],
  });
}

// Preview with mapping, valid/invalid/duplicate counts and a row-level error list, then confirm.
function showImportPreview(ctx, text) {
  const existing = ctx.store.state.trades;
  const r = analyzeImport(text, { existingTrades: existing });
  const body = document.createElement('div');
  if (r.error) {
    body.innerHTML = `<p class="pos">${esc(r.error)}</p><p class="small muted">Found columns: ${esc((r.headers || []).join(', '))}</p>`;
    openModal({ title: 'Import problem', body, actions: [{ label: 'Close', kind: 'ghost', onClick: (c) => c() }] });
    return;
  }
  const bad = r.rows.filter((x) => x.status === 'invalid').slice(0, 25);
  body.innerHTML = `<div class="table-list">
    <div class="line"><span>Rows in file</span><span>${r.counts.total}</span></div>
    <div class="line"><span>Valid, will import</span><span class="pos">${r.counts.valid}</span></div>
    <div class="line"><span>Duplicates, will skip</span><span class="muted">${r.counts.duplicate}</span></div>
    <div class="line"><span>Invalid, will skip</span><span class="neg">${r.counts.invalid}</span></div>
  </div>
  ${bad.length ? `<h3>Invalid rows (first ${bad.length})</h3>${bad.map((x) => `<p class="small"><strong>Line ${x.line}:</strong> ${esc(x.errors.join('; '))}</p>`).join('')}` : ''}
  ${r.rows.some((x) => x.status === 'duplicate') ? '<p class="small muted">Duplicates match an existing trade on instrument, direction, entry time, price, lots and account.</p>' : ''}`;
  const importable = r.rows.filter((x) => x.status === 'valid').map((x) => x.trade);
  openModal({
    title: 'Import preview',
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: (c) => c() },
      { label: `Import ${importable.length}`, kind: 'primary', onClick: (c) => {
        if (!importable.length) return toast('Nothing valid to import.');
        const sr = ctx.store.addTrades(importable);
        if (!sr.ok) return toast(sr.error || 'Save failed. Nothing was imported.');
        c();
        toast(`Imported ${importable.length}, skipped ${r.counts.total - importable.length}`);
        ctx.rerender();
      } },
    ],
  });
}
