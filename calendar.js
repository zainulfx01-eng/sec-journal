// Trading calendar: month grid of daily net P/L, weekly and monthly summaries, tap-a-day drill-down.
// Day logic lives in insights.js (monthGrid, tradesOnDay). Days use the Africa/Lagos calendar.
import { esc, money, $$ } from './ui.js';
import { dayKey, monthGrid, shiftMonth, tradesOnDay, WEEKDAYS, addDays } from './insights.js';
import { fmtDate } from './ui.js';

export function initCalendarState(ctx, todayKey) {
  if (!ctx.calendarState) {
    const [y, m] = todayKey.split('-').map(Number);
    ctx.calendarState = { year: y, month: m, selected: null };
  }
  return ctx.calendarState;
}

export function renderCalendar(el, ctx, st) {
  if (!el) return;
  const trades = ctx.store.state.trades;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  const todayKey = dayKey(new Date().toISOString());
  const g = monthGrid(st.year, st.month, trades, todayKey);
  const label = new Date(Date.UTC(st.year, st.month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  el.innerHTML = `
    <div class="card cal">
      <div class="cal-head">
        <button class="btn" id="cal-prev" aria-label="Previous month">‹</button>
        <h3 style="margin:0">${esc(label)}</h3>
        <button class="btn" id="cal-next" aria-label="Next month">›</button>
      </div>
      <div class="cal-dow">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">
        ${g.weeks.map((w) => w.map((c) => c.inMonth
          ? `<button class="cal-day ${c.status} ${c.isToday ? 'today' : ''} ${st.selected === c.key ? 'sel' : ''}" data-key="${c.key}" aria-label="${c.key}, ${dayLabel(c)}">
               <span class="dn">${c.day}</span>
               ${c.closed ? `<span class="dv">${esc(compact(c.net, cur))}</span>` : (c.open ? '<span class="dv open">open</span>' : '')}
             </button>`
          : '<span class="cal-day blank"></span>').join('')).join('')}
      </div>
      <div class="cal-legend small muted">
        <span><i class="sw profit"></i>profit day</span><span><i class="sw loss"></i>loss day</span><span><i class="sw be"></i>break-even</span><span><i class="sw none"></i>no trades</span>
      </div>
    </div>
    <div class="card"><h3>Month</h3>
      <div class="kv">
        ${kvl('Net P/L', money(g.summary.net, cur, { sign: true }), g.summary.net)}
        ${kvl('Trading days', String(g.summary.tradingDays))}
        ${kvl('Profit / loss / BE days', `${g.summary.profitDays} / ${g.summary.lossDays} / ${g.summary.beDays}`)}
        ${kvl('Closed trades', String(g.summary.closed))}
        ${g.summary.openCount ? kvl('Open trades (not in P/L)', String(g.summary.openCount)) : ''}
      </div>
    </div>
    <div class="card"><h3>Weeks</h3>
      ${g.weekSummaries.map((w, i) => w.from ? `<div class="line"><span class="muted small">Week ${i + 1} · ${esc(fmtShort(w.from))}–${esc(fmtShort(w.to))}</span><span class="${w.net > 0 ? 'pos' : w.net < 0 ? 'neg' : 'flat'}">${money(w.net, cur, { sign: true })} <span class="muted small">${w.tradingDays} day${w.tradingDays === 1 ? '' : 's'}</span></span></div>` : '').join('')}
    </div>
    <div id="cal-day"></div>
    <p class="small muted">Green is a net profit day, red a net loss day, grey break-even or no trades. A closed trade counts on its exit day; an open trade counts on its entry day but adds no P/L until closed.</p>`;

  el.querySelector('#cal-prev').addEventListener('click', () => { Object.assign(st, shift(st, -1)); renderCalendar(el, ctx, st); });
  el.querySelector('#cal-next').addEventListener('click', () => { Object.assign(st, shift(st, 1)); renderCalendar(el, ctx, st); });
  $$('.cal-day[data-key]', el).forEach((b) => b.addEventListener('click', () => {
    st.selected = b.dataset.key;
    renderCalendar(el, ctx, st);
  }));
  if (st.selected) renderDay(el.querySelector('#cal-day'), ctx, st.selected, cur);
}

function shift(st, d) {
  const n = shiftMonth(st.year, st.month, d);
  return { year: n.year, month: n.month, selected: null };
}

function renderDay(el, ctx, key, cur) {
  const list = tradesOnDay(ctx.store.state.trades, key);
  const closed = list.filter((t) => t.status === 'closed' && t.netPL != null);
  const net = closed.reduce((a, t) => a + Number(t.netPL), 0);
  el.innerHTML = `<div class="card"><div class="line"><h3 style="margin:0">${esc(fmtLong(key))}</h3><button class="btn" id="cal-close">Close</button></div>
    ${list.length ? `<p class="small muted">${closed.length} closed · net <span class="${net > 0 ? 'pos' : net < 0 ? 'neg' : 'flat'}">${money(net, cur, { sign: true })}</span></p>
    ${list.map((t) => `<div class="trade-mini"><div class="line"><span>${esc(t.instrument)} ${esc(t.direction)} · ${esc(String(t.lots))} lots</span><span class="${t.status === 'closed' ? (t.netPL > 0 ? 'pos' : t.netPL < 0 ? 'neg' : 'flat') : 'muted'}">${t.status === 'closed' ? money(t.netPL, cur, { sign: true }) : 'open'}</span></div><div class="muted small">${esc(t.session || '')}${t.strategy ? ' · ' + esc(t.strategy) : ''}${t.session || t.strategy ? ' · ' : ''}${fmtDate(t.entryTime)}</div></div>`).join('')}`
      : '<p class="muted">No trades on this day.</p>'}
    </div>`;
  el.querySelector('#cal-close').addEventListener('click', () => { el.innerHTML = ''; ctx.calendarState.selected = null; });
}

// Chip for a day cell: compact money so it fits the cell.
function compact(n, cur) {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : a.toFixed(a % 1 ? 0 : 0);
  return `${sign}${s}`;
}
function dayLabel(c) {
  if (c.status === 'none') return 'no trades';
  if (c.status === 'open') return 'open trade';
  if (c.status === 'profit') return 'profit day';
  if (c.status === 'loss') return 'loss day';
  return 'break-even day';
}
function kvl(label, value, sign = 0) {
  const cls = sign > 0 ? 'pos' : sign < 0 ? 'neg' : '';
  return `<div class="line"><span class="muted">${esc(label)}</span><span class="${cls}">${esc(String(value))}</span></div>`;
}
function fmtShort(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function fmtLong(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export { addDays };
