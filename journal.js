// Journal: compact trade cards, search, filters, sort, add/edit/delete with validation.
import { esc, money, plClass, fmtDate, openModal, confirmDialog, toast, isoToLocalInput, localInputToIso } from './ui.js';
import { filterTrades, sortTrades, distinctValues, validateTrade } from './trades.js';
import { SESSIONS, DIRECTIONS, STATUSES, PLAN_VALUES, MAX_TEXT, MAX_SHORT_TEXT } from './config.js';
import { setBackButton } from './telegram.js';
import { screenshotUsage, compressImageFile } from './shots.js';

const SORTS = [['date-desc', 'Newest'], ['date-asc', 'Oldest'], ['symbol-asc', 'Symbol'], ['result-desc', 'Result'], ['pl-desc', 'P/L high'], ['pl-asc', 'P/L low']];
const RESULTS = [['all', 'All'], ['profit', 'Profit'], ['loss', 'Loss'], ['breakeven', 'BE'], ['open', 'Open']];

export function renderJournal(view, ctx) {
  const f = ctx.journalFilters || (ctx.journalFilters = { result: 'all', sort: 'date-desc', search: '', symbol: '', session: 'all', strategy: 'all', from: '', to: '' });
  const trades = ctx.store.state.trades;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  const symbols = distinctValues(trades, 'instrument');
  const sessions = distinctValues(trades, 'session');
  const strategies = distinctValues(trades, 'strategy');
  const list = sortTrades(filterTrades(trades, f), f.sort);

  view.innerHTML = `
    <div class="row"><h1 style="flex:1">Journal</h1><span class="muted small">${list.length} of ${trades.length}</span></div>
    <div class="filters card">
      <input class="input" id="q" type="search" placeholder="Search notes, strategy, instrument…" value="${esc(f.search)}" aria-label="Search trades"/>
      <div class="segmented" role="group" aria-label="Result filter">${RESULTS.map(([k, l]) => `<button data-result="${k}" aria-pressed="${f.result === k}">${l}</button>`).join('')}</div>
      <div class="grid2">
        <select class="input" id="sym" aria-label="Symbol"><option value="">All symbols</option>${symbols.map((s) => `<option ${f.symbol === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select class="input" id="sort" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="input" id="sess" aria-label="Session"><option value="all">All sessions</option>${sessions.map((s) => `<option ${f.session === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select class="input" id="strat" aria-label="Strategy"><option value="all">All strategies</option>${strategies.map((s) => `<option ${f.strategy === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <input class="input" id="from" type="date" value="${esc(f.from)}" aria-label="From date"/>
        <input class="input" id="to" type="date" value="${esc(f.to)}" aria-label="To date"/>
      </div>
    </div>
    ${!trades.length ? `<div class="empty"><h2>No trades yet</h2><p>Tap + to log your first trade.</p></div>` :
      !list.length ? `<div class="empty"><p>No trades match these filters.</p><button class="btn small" id="clear">Clear filters</button></div>` :
      list.map((t) => tradeCard(t, cur)).join('')}`;

  const rerender = () => renderJournal(view, ctx);
  view.querySelectorAll('[data-result]').forEach((b) => b.addEventListener('click', () => { f.result = b.dataset.result; rerender(); }));
  const bind = (id, key) => { const el = view.querySelector('#' + id); el && el.addEventListener('change', () => { f[key] = el.value; rerender(); }); };
  bind('sym', 'symbol'); bind('sort', 'sort'); bind('sess', 'session'); bind('strat', 'strategy'); bind('from', 'from'); bind('to', 'to');
  const q = view.querySelector('#q');
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.search = q.value; const pos = q.selectionStart; rerender(); const n = view.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 200); });
  view.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openTradeView(el.dataset.open, ctx)));
  const clr = view.querySelector('#clear');
  if (clr) clr.addEventListener('click', () => { ctx.journalFilters = null; rerender(); });
}

function tradeCard(t, cur) {
  const pl = t.status === 'closed' ? money(t.netPL, cur, { sign: true }) : 'open';
  return `<button class="trade-card" data-open="${esc(t.id)}">
    <div class="top"><span class="sym">${esc(t.instrument)}</span><span class="chip ${esc(t.direction)}">${esc(t.direction)}</span><span class="chip ${esc(t.status)}">${esc(t.status)}</span><span class="pl ${t.status === 'closed' ? plClass(t.netPL) : 'muted'}">${pl}</span></div>
    <div class="meta">${fmtDate(t.entryTime)} · ${esc(t.lots)} lots${t.strategy ? ' · ' + esc(t.strategy) : ''}${t.session ? ' · ' + esc(t.session) : ''}${t.planRR != null ? ' · plan RR ' + t.planRR : ''}</div>
  </button>`;
}

function openTradeView(id, ctx) {
  const t = ctx.store.state.trades.find((x) => x.id === id);
  if (!t) return;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  const rows = [['Account', t.accountName], ['Entry', `${t.entryPrice} @ ${fmtDate(t.entryTime)}`], ['Exit', t.exitPrice != null ? `${t.exitPrice} @ ${fmtDate(t.exitTime)}` : 'open'],
    ['SL / TP', `${t.stopLoss ?? '—'} / ${t.takeProfit ?? '—'}`], ['Lots', t.lots], ['Gross / Commission / Swap / Other', `${t.grossPL ?? '—'} / ${t.commission ?? '—'} / ${t.swap ?? '—'} / ${t.otherCosts ?? '—'}`],
    ['Net P/L', t.status === 'closed' ? money(t.netPL, cur, { sign: true }) : 'open'], ['Planned RR / Realized R', `${t.planRR ?? '—'} / ${t.realizedR ?? '—'}`],
    ['Session / Strategy', `${t.session || '—'} / ${t.strategy || '—'}`], ['Entry reason', t.entryReason], ['Exit reason', t.exitReason],
    ['Emotions before / during', `${t.emotionsBefore || '—'} / ${t.emotionsDuring || '—'}`], ['Plan followed', t.planFollowed || '—'], ['Mistakes', t.mistakes], ['Lessons', t.lessons],
    ['Last updated', fmtDate(t.updatedAt)]];
  const body = `<div class="table-list">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div class="line"><span class="muted" style="width:44%">${esc(k)}</span><span style="flex:1;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}</div>`;
  const shotsHtml = renderShotsSection(t, ctx);
  const bodyEl = document.createElement('div');
  bodyEl.innerHTML = body + shotsHtml;
  const m = openModal({
    title: `${t.instrument} ${t.direction}`,
    body: bodyEl,
    actions: [
      { label: 'Delete', kind: 'danger', onClick: async (close) => { if (await confirmDialog('Delete trade?', 'This removes the trade from this device. Export a backup first if you want to keep it.')) { ctx.store.deleteTrade(t.id); close(); toast('Trade deleted'); renderJournal(document.querySelector('#view'), ctx); } } },
      { label: 'Edit', kind: 'primary', onClick: (close) => { close(); openTradeForm(t, ctx); } },
    ],
  });
  // Re-open the trade view after a screenshot change so the list stays fresh.
  const refresh = () => { m.close(); openTradeView(t.id, ctx); };
  wireShots(bodyEl, t, ctx, refresh);
  void m;
}

// Add/edit form with all journal fields and validation.
export function openTradeForm(trade, ctx) {
  const v = trade || {};
  const s = ctx.store.state.settings;
  const sel = (name, opts, cur) => `<select name="${name}">${['', ...opts].map((o) => `<option value="${esc(o)}" ${o === (cur ?? '') ? 'selected' : ''}>${o === '' ? '—' : esc(o)}</option>`).join('')}</select>`;
  const inp = (name, label, val = '', type = 'text', attrs = '', wide = false) => `<div class="field ${wide ? 'wide' : ''}" data-field="${name}"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(val)}" ${attrs}/><div class="error" data-err="${name}"></div></div>`;
  const area = (name, label, val = '') => `<div class="field wide" data-field="${name}"><label for="f-${name}">${esc(label)}</label><textarea id="f-${name}" name="${name}" maxlength="${MAX_TEXT}">${esc(val)}</textarea><div class="error" data-err="${name}"></div></div>`;
  const body = document.createElement('div');
  body.innerHTML = `<form class="grid-form" id="trade-form" novalidate>
    <div class="section-head wide">Trade</div>
    ${inp('accountName', 'Account name', v.accountName || s.defaultAccount || '', 'text', `maxlength="${MAX_SHORT_TEXT}"`)}
    <div class="field" data-field="instrument"><label for="f-instrument">Instrument</label><input id="f-instrument" name="instrument" list="instr-list" value="${esc(v.instrument || '')}" placeholder="EURUSD, XAUUSD…"/><datalist id="instr-list">${Object.keys(ctx.specs || {}).map((k) => `<option value="${esc(k)}">`).join('')}</datalist><div class="error" data-err="instrument"></div></div>
    <div class="field" data-field="direction"><label for="f-direction">Direction</label><select id="f-direction" name="direction">${['', ...DIRECTIONS].map((d) => `<option value="${d}" ${d === (v.direction || '') ? 'selected' : ''}>${d || '—'}</option>`).join('')}</select><div class="error" data-err="direction"></div></div>
    <div class="field" data-field="status"><label for="f-status">Status</label><select id="f-status" name="status">${STATUSES.map((d) => `<option value="${d}" ${d === (v.status || 'closed') ? 'selected' : ''}>${d}</option>`).join('')}</select><div class="error" data-err="status"></div></div>
    ${inp('entryTime', 'Entry time (WAT)', isoToLocalInput(v.entryTime), 'datetime-local')}
    ${inp('exitTime', 'Exit time (WAT)', isoToLocalInput(v.exitTime), 'datetime-local')}
    ${inp('entryPrice', 'Entry price', v.entryPrice ?? '', 'text', 'inputmode="decimal"')}
    ${inp('exitPrice', 'Exit price', v.exitPrice ?? '', 'text', 'inputmode="decimal"')}
    ${inp('stopLoss', 'Stop loss', v.stopLoss ?? '', 'text', 'inputmode="decimal"')}
    ${inp('takeProfit', 'Take profit', v.takeProfit ?? '', 'text', 'inputmode="decimal"')}
    ${inp('lots', 'Lots', v.lots ?? '', 'text', 'inputmode="decimal"')}
    <div class="section-head wide">Money (estimates unless from broker)</div>
    ${inp('accountCurrency', 'Account currency', v.accountCurrency || s.accountCurrency || 'USD', 'text', 'maxlength="3"')}
    ${inp('initialRisk', 'Initial risk (money)', v.initialRisk ?? '', 'text', 'inputmode="decimal"')}
    ${inp('grossPL', 'Gross P/L', v.grossPL ?? '', 'text', 'inputmode="decimal"')}
    ${inp('commission', 'Commission', v.commission ?? '', 'text', 'inputmode="decimal"')}
    ${inp('swap', 'Swap', v.swap ?? '', 'text', 'inputmode="decimal"')}
    ${inp('otherCosts', 'Other costs', v.otherCosts ?? '', 'text', 'inputmode="decimal"')}
    ${inp('netPL', 'Net P/L (leave blank to compute)', v.netPL ?? '', 'text', 'inputmode="decimal"')}
    ${inp('planRR', 'Planned RR', v.planRR ?? '', 'text', 'inputmode="decimal"')}
    ${inp('realizedR', 'Realized R', v.realizedR ?? '', 'text', 'inputmode="decimal"')}
    <div class="section-head wide">Context</div>
    <div class="field" data-field="session"><label for="f-session">Session</label>${sel('session', SESSIONS, v.session)}<div class="error" data-err="session"></div></div>
    ${inp('strategy', 'Strategy', v.strategy || '', 'text', `maxlength="${MAX_SHORT_TEXT}"`)}
    <div class="field" data-field="planFollowed"><label for="f-planFollowed">Plan followed</label>${sel('planFollowed', PLAN_VALUES, v.planFollowed)}<div class="error" data-err="planFollowed"></div></div>
    ${area('entryReason', 'Entry reason', v.entryReason)}
    ${area('exitReason', 'Exit reason', v.exitReason)}
    ${inp('emotionsBefore', 'Emotions before', v.emotionsBefore || '', 'text', `maxlength="${MAX_SHORT_TEXT}"`)}
    ${inp('emotionsDuring', 'Emotions during', v.emotionsDuring || '', 'text', `maxlength="${MAX_SHORT_TEXT}"`)}
    ${area('mistakes', 'Mistakes', v.mistakes)}
    ${area('lessons', 'Lessons', v.lessons)}
  </form><div class="errors-box hidden" id="form-errors"></div>`;

  const title = trade ? 'Edit trade' : 'New trade';
  const m = openModal({
    title,
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: (c) => c() },
      { label: 'Save trade', kind: 'primary', onClick: (close) => submit(body, trade, ctx, close) },
    ],
  });
  setBackButton(false);
  void m;
}

function formValues(body) {
  const f = body.querySelector('#trade-form');
  const out = {};
  for (const el of f.elements) if (el.name) out[el.name] = el.value;
  // datetime-local -> canonical UTC ISO (WAT)
  out.entryTime = localInputToIso(out.entryTime);
  out.exitTime = localInputToIso(out.exitTime);
  return out;
}

function submit(body, trade, ctx, close) {
  const raw = formValues(body);
  const res = validateTrade({ ...raw, id: trade?.id });
  body.querySelectorAll('.field').forEach((el) => el.classList.remove('invalid'));
  body.querySelectorAll('[data-err]').forEach((el) => (el.textContent = ''));
  const box = body.querySelector('#form-errors');
  if (!res.valid) {
    for (const [k, msg] of Object.entries(res.errors)) {
      const field = body.querySelector(`[data-field="${k}"]`);
      if (field) { field.classList.add('invalid'); const e = field.querySelector('[data-err]'); if (e) e.textContent = msg; }
    }
    box.classList.remove('hidden');
    box.textContent = `Fix ${Object.keys(res.errors).length} field(s) to save.`;
    body.querySelector('.invalid input, .invalid select, .invalid textarea')?.focus();
    return;
  }
  const r = ctx.store.upsertTrade({ ...raw, id: trade?.id });
  if (!r.ok) {
    box.classList.remove('hidden');
    box.textContent = Object.values(r.errors || {}).join(' ') || 'Could not save.';
    return;
  }
  close();
  toast(trade ? 'Trade updated' : 'Trade saved');
  // Re-render the current tab through the router (set in app.js).
  if (ctx.rerender) ctx.rerender();
}

// Screenshot attachments on a trade. Local-only storage (Stage 2); Stage 3 moves them to Supabase.
function renderShotsSection(t, ctx) {
  const shots = Array.isArray(t.screenshots) ? t.screenshots : [];
  const usage = screenshotUsage(ctx.store.state.trades);
  const warn = usage.level === 'warn' ? `<p class="small warn-text">Screenshot storage is at ${Math.round(usage.ratio * 100)}% of the 4 MB local cap. Remove old ones or export a backup.</p>` : '';
  const full = usage.level === 'full' ? '<p class="small neg">Screenshot storage is full. Delete screenshots before adding more.</p>' : '';
  const html = `<div class="shots" data-trade="${esc(t.id)}">
    <h3 style="margin:14px 0 6px">Screenshots <span class="muted small">(stored on this device only)</span></h3>
    ${shots.length ? `<div class="shot-grid">${shots.map((s) => `<figure class="shot"><img class="shot-img" data-shot-view="${esc(s.id)}" src="${s.dataUrl}" alt="${esc(s.kind)} screenshot" loading="lazy"/><figcaption class="small muted">${esc(s.kind)}</figcaption><button class="btn ghost small" data-shot-del="${esc(s.id)}">Delete</button></figure>`).join('')}</div>` : '<p class="muted small">No screenshots yet. Add a before and after image for this trade.</p>'}
    ${warn}${full}
    <div class="row" style="gap:8px;margin-top:8px"><select id="shot-kind" aria-label="Screenshot kind"><option value="before">Before</option><option value="after">After</option></select>
    <label class="btn">Add screenshot<input type="file" accept="image/*" id="shot-file" hidden/></label></div>
    <div class="error" id="shot-err"></div>
  </div>`;
  return html;
}

// Wire the screenshot controls after the modal is open. Call from openTradeView via the modal body.
export function wireShots(root, t, ctx, refresh) {
  const file = root.querySelector('#shot-file');
  if (file) file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    const err = root.querySelector('#shot-err');
    err.textContent = '';
    try {
      const kind = root.querySelector('#shot-kind').value;
      const img = await compressImageFile(f);
      const r = ctx.store.addScreenshot(t.id, { kind, ...img });
      if (!r.ok) { err.textContent = r.error; return; }
      toast('Screenshot saved');
      refresh();
    } catch (e) {
      err.textContent = e.message || 'Could not add that image.';
    }
  });
  root.querySelectorAll('[data-shot-view]').forEach((img) => img.addEventListener('click', () => {
    const s = (t.screenshots || []).find((x) => x.id === img.dataset.shotView);
    if (!s) return;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${s.dataUrl}" alt="${esc(s.kind)} screenshot"/><span class="small muted">${esc(s.kind)} · tap anywhere to close</span>`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }));
  root.querySelectorAll('[data-shot-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete screenshot?', 'This removes the image from this device.'))) return;
    const r = ctx.store.removeScreenshot(t.id, b.dataset.shotDel);
    if (!r.ok) { toast(r.error || 'Could not delete'); return; }
    toast('Screenshot deleted');
    refresh();
  }));
}
