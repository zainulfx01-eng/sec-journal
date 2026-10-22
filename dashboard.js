// Dashboard: computed stats from real records, period filter, equity curve, recent trades, empty state.
import { computeStats } from './trades.js';
import { esc, money, plClass, fmtDate } from './ui.js';
import { equityChart } from './chart.js';
import { navigate } from './app.js';

const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time']];

export function renderDashboard(view, ctx) {
  const s = ctx.store.state;
  const trades = s.trades;
  if (!trades.length) {
    view.innerHTML = `<div class="empty"><h2>No trades yet</h2><p>Log your first trade to see stats, the equity curve and recent activity. Everything is saved on this device.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="empty-add">Add your first trade</button><button class="btn" id="empty-import">Import CSV</button></div></div>`;
    view.querySelector('#empty-add').addEventListener('click', () => navigate('journal', { add: true }));
    view.querySelector('#empty-import').addEventListener('click', () => navigate('settings', { import: true }));
    return;
  }
  const period = ctx.dashPeriod || 'all';
  const st = computeStats(trades, { period, startingBalance: s.settings.startingBalance, now: new Date() });
  const cur = s.settings.accountCurrency || 'USD';
  const pf = st.profitFactor === Infinity ? '∞' : st.profitFactor == null ? '—' : st.profitFactor.toFixed(2);
  const recent = [...trades].sort((a, b) => (b.entryTime || 0) - (a.entryTime || 0)).slice(0, 5);

  view.innerHTML = `
    <div class="row"><h1 style="flex:1">Dashboard</h1><div class="segmented" role="group" aria-label="Period">
      ${PERIODS.map(([k, l]) => `<button data-period="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>
    <div class="stat-grid">
      <div class="stat hero"><div class="label">Net P/L (${esc(period)}, ${esc(cur)})</div><div class="value ${plClass(st.net)}">${money(st.net, cur, { sign: true })}</div>
        <div class="small muted">Estimate unless entered from broker statements. ${st.openCount} open trade(s) not counted.</div></div>
      <div class="stat"><div class="label">Win rate</div><div class="value">${st.winRate == null ? '—' : st.winRate.toFixed(1) + '%'}</div></div>
      <div class="stat"><div class="label">Closed trades</div><div class="value">${st.totalClosed}</div></div>
      <div class="stat"><div class="label">Winners / Losers / BE</div><div class="value">${st.winners} / ${st.losers} / ${st.breakeven}</div></div>
      <div class="stat"><div class="label">Profit factor</div><div class="value">${pf}</div></div>
      <div class="stat"><div class="label">Avg R</div><div class="value">${st.avgR == null ? '—' : st.avgR.toFixed(2) + 'R'}</div><div class="small muted">${st.rCount} trade(s) with risk</div></div>
      <div class="stat"><div class="label">Balance</div><div class="value">${st.currentBalance == null ? '—' : money(st.currentBalance, cur)}</div><div class="small muted">${st.currentBalance == null ? 'Set a starting balance in Settings' : 'starting balance + closed P/L'}</div></div>
      <div class="stat"><div class="label">Max drawdown</div><div class="value neg">${st.maxDrawdownAbs ? money(-st.maxDrawdownAbs, cur) : '—'}</div><div class="small muted">${st.maxDrawdownPct ? st.maxDrawdownPct.toFixed(1) + '%' : ''}</div></div>
    </div>
    <div class="card"><div class="card-title">Equity curve</div><div id="equity"></div></div>
    <div class="card"><div class="card-title">Recent trades</div>
      <div class="table-list">${recent.map((t) => `<div class="line"><span style="flex:1">${esc(t.instrument)} <span class="chip ${esc(t.direction)}">${esc(t.direction)}</span> <span class="muted small">${fmtDate(t.entryTime)}</span></span><span class="${plClass(t.netPL)}">${t.status === 'open' ? 'open' : money(t.netPL, cur, { sign: true })}</span></div>`).join('')}</div>
      <button class="btn ghost small" id="see-all" style="margin-top:8px">See all trades</button></div>`;

  view.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { ctx.dashPeriod = b.dataset.period; renderDashboard(view, ctx); }));
  view.querySelector('#see-all').addEventListener('click', () => navigate('journal', {}));
  equityChart(view.querySelector('#equity'), st.curve, cur);
}
