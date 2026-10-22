// Analytics: summary stats and a per-instrument breakdown, computed from closed trades.
import { computeStats, distinctValues, filterTrades } from './trades.js';
import { esc, money } from './ui.js';
import { equityChart } from './chart.js';

export function renderAnalytics(view, ctx) {
  const trades = ctx.store.state.trades;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  if (!trades.length) {
    view.innerHTML = '<div class="empty"><h2>No analytics yet</h2><p>Add or import trades and analytics will fill in.</p></div>';
    return;
  }
  const st = computeStats(trades, { period: 'all', startingBalance: ctx.store.state.settings.startingBalance, now: new Date() });
  const bySym = distinctValues(trades, 'instrument').map((sym) => {
    const sub = filterTrades(trades, { symbol: sym, result: 'all' });
    const s2 = computeStats(sub, { period: 'all' });
    return { sym, n: s2.totalClosed, net: s2.net, win: s2.winRate };
  }).sort((a, b) => b.net - a.net);

  view.innerHTML = `
    <h1>Analytics</h1>
    <div class="card"><h3>Equity curve</h3><div id="eq"></div></div>
    <div class="card"><h3>By instrument</h3>
      ${bySym.map((r) => `<div class="line"><span>${esc(r.sym)} <span class="muted small">(${r.n} closed${r.win == null ? '' : ', ' + r.win + '% win'})</span></span><span class="${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'flat'}">${money(r.net, cur, { sign: true })}</span></div>`).join('')}
    </div>
    <p class="small muted">Net P/L is from your entries (broker figures when entered). Charts and breakdowns are estimates for planning only.</p>`;
  equityChart(view.querySelector('#eq'), st.curve, cur);
}
