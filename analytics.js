// Analytics: deep-dive breakdowns with a date filter, plus the calendar and discipline sections.
// All numbers come from insights.js (pure, tested). Descriptive only.
import { esc, money, $, $$ } from './ui.js';
import { equityChart } from './chart.js';
import { analyticsSnapshot, presetRange, dayKey, WEEKDAYS } from './insights.js';
import { renderCalendar, initCalendarState } from './calendar.js';
import { renderDiscipline } from './discipline.js';
import { screenshotUsage } from './shots.js';

const PRESETS = [['all', 'All'], ['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30 days'], ['custom', 'Custom']];

export function renderAnalytics(view, ctx) {
  const f = ctx.analyticsFilter || (ctx.analyticsFilter = { preset: 'all', from: '', to: '', section: 'deep' });
  const trades = ctx.store.state.trades;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  const today = dayKey(new Date().toISOString());
  if (!trades.length) {
    view.innerHTML = '<div class="empty"><h2>No analytics yet</h2><p>Add or import trades and analytics will fill in.</p></div>';
    return;
  }
  const range = presetRange(f.preset, today, { from: f.from, to: f.to });
  const snap = analyticsSnapshot(trades, range);
  const s = snap.summary;
  const pf = s.profitFactor == null ? (s.grossLoss === 0 && s.grossWin > 0 ? 'n/a (no losses)' : 'n/a') : s.profitFactor;

  view.innerHTML = `
    <h1>Analytics</h1>
    <div class="seg" role="tablist" aria-label="Analytics section">
      ${[['deep', 'Deep-dive'], ['calendar', 'Calendar'], ['discipline', 'Discipline & journal']].map(([k, l]) => `<button class="seg-btn${f.section === k ? ' on' : ''}" data-section="${k}">${l}</button>`).join('')}
    </div>
    ${f.section === 'deep' ? `
    <div class="card">
      <div class="chips" role="group" aria-label="Date range">${PRESETS.map(([k, l]) => `<button class="chip${f.preset === k ? ' on' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
      ${f.preset === 'custom' ? `<div class="grid2" style="margin-top:8px"><label class="small muted">From<input type="date" id="an-from" value="${esc(f.from)}"/></label><label class="small muted">To<input type="date" id="an-to" value="${esc(f.to)}"/></label></div>` : ''}
      <p class="small muted" style="margin:8px 0 0">${snap.count} closed trade${snap.count === 1 ? '' : 's'} in range${range.from || range.to ? ` (${esc(range.from || 'start')} to ${esc(range.to || 'today')})` : ''}. Days use Africa/Lagos time. ${snap.openCount ? snap.openCount + ' open trade(s) are excluded.' : ''}</p>
    </div>
    ${snap.count === 0 ? '<div class="empty"><h2>No closed trades in this range</h2><p>Pick a wider range.</p></div>' : `
    <div class="card"><h3>Summary</h3>
      <div class="kv">
        ${kv('Net P/L', money(s.net, cur, { sign: true }), s.net)}
        ${kv('Win rate', s.winRate == null ? '—' : s.winRate + '%')}
        ${kv('Winners / losers / BE', `${s.winners} / ${s.losers} / ${s.breakeven}`)}
        ${kv('Profit factor', typeof pf === 'number' ? pf : pf)}
        ${kv('Average winner', s.avgWin == null ? '—' : money(s.avgWin, cur, { sign: true }), 1)}
        ${kv('Average loser', s.avgLoss == null ? '—' : money(s.avgLoss, cur, { sign: true }), -1)}
        ${kv('Largest winner', s.largestWin ? `${money(s.largestWin.netPL, cur, { sign: true })} ${esc(s.largestWin.instrument || '')} · ${esc(s.largestWin.date || '')}` : '—', 1)}
        ${kv('Largest loser', s.largestLoss ? `${money(s.largestLoss.netPL, cur, { sign: true })} ${esc(s.largestLoss.instrument || '')} · ${esc(s.largestLoss.date || '')}` : '—', -1)}
        ${kv('Max drawdown', `${money(-snap.drawdown.abs, cur)} (${snap.drawdown.pct}% of peak)`, snap.drawdown.abs ? -1 : 0)}
      </div>
    </div>
    <div class="card"><h3>Equity curve</h3><div id="eq"></div></div>
    <div class="card"><h3>Streaks and consistency</h3>
      <div class="kv">
        ${kv('Longest win streak', String(snap.streaks.longestWin))}
        ${kv('Longest loss streak', String(snap.streaks.longestLoss))}
        ${kv('Current run', snap.streaks.current.type ? `${snap.streaks.current.length} ${snap.streaks.current.type === 'win' ? 'win' : 'loss'}${snap.streaks.current.length > 1 ? 's' : ''} in a row` : 'none')}
        ${kv('Trading days', String(snap.consistency.tradingDays))}
        ${kv('Profitable days', snap.consistency.profitDayShare == null ? '—' : `${snap.consistency.profitDays} (${snap.consistency.profitDayShare}%)`)}
        ${kv('Average daily P/L', snap.consistency.meanDaily == null ? '—' : money(snap.consistency.meanDaily, cur, { sign: true }))}
        ${kv('Daily P/L spread (std dev)', snap.consistency.stdDevDaily == null ? '—' : money(snap.consistency.stdDevDaily, cur))}
      </div>
      <p class="small muted">Consistency is descriptive: a lower spread means daily results sat closer to the average. It is not a forecast.</p>
    </div>
    ${breakdown('Long vs short', snap.direction, cur)}
    ${breakdown('By instrument', snap.symbol, cur)}
    ${breakdown('By session', snap.session, cur)}
    ${breakdown('By strategy', snap.strategy, cur)}
    ${breakdown('By weekday (entry day)', snap.weekday, cur)}
    `}` : ''}
    ${f.section === 'calendar' ? '<div id="cal-host"></div>' : ''}
    ${f.section === 'discipline' ? '<div id="disc-host"></div>' : ''}
    <p class="small muted">Charts and breakdowns describe your recorded history. They are not forecasts or advice.</p>`;

  $$('[data-section]', view).forEach((b) => b.addEventListener('click', () => { f.section = b.dataset.section; renderAnalytics(view, ctx); }));
  $$('[data-preset]', view).forEach((b) => b.addEventListener('click', () => { f.preset = b.dataset.preset; renderAnalytics(view, ctx); }));
  const fr = view.querySelector('#an-from'); const to = view.querySelector('#an-to');
  if (fr) fr.addEventListener('change', () => { f.from = fr.value; renderAnalytics(view, ctx); });
  if (to) to.addEventListener('change', () => { f.to = to.value; renderAnalytics(view, ctx); });

  if (f.section === 'deep' && snap.count) equityChart(view.querySelector('#eq'), snap.curve, cur);
  if (f.section === 'calendar') renderCalendar(view.querySelector('#cal-host'), ctx, initCalendarState(ctx, today));
  if (f.section === 'discipline') renderDiscipline(view.querySelector('#disc-host'), ctx, today);
}

function kv(label, value, sign = 0) {
  const cls = sign > 0 ? 'pos' : sign < 0 ? 'neg' : '';
  return `<div class="line"><span class="muted">${esc(label)}</span><span class="${cls}">${esc(String(value))}</span></div>`;
}

function breakdown(title, rows, cur) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
  return `<div class="card"><h3>${esc(title)}</h3>
    ${rows.map((r) => `<div class="bd-row">
      <div class="line"><span>${esc(r.key)} <span class="muted small">(${r.n} closed${r.winRate == null ? '' : ', ' + r.winRate + '% win'}${r.profitFactor == null ? '' : ', PF ' + r.profitFactor})</span></span><span class="${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'flat'}">${money(r.net, cur, { sign: true })}</span></div>
      <div class="bar"><i class="${r.net >= 0 ? 'pos' : 'neg'}" style="width:${Math.round((Math.abs(r.net) / max) * 100)}%"></i></div>
    </div>`).join('')}
    <p class="small muted" style="margin:6px 0 0">Shows win rate and profit factor where the group has data. A small sample is not a pattern.</p>
  </div>`;
}

export { WEEKDAYS, screenshotUsage };
