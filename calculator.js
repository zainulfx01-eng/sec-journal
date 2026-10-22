// Risk/reward calculator: two modes. Every output is labelled an estimate.
import { esc, money } from './ui.js';
import { planTrade, sizePosition } from './calc.js';
import { DEFAULT_INSTRUMENTS } from './config.js';

export function renderCalculator(view, ctx) {
  const s = ctx.store.state.settings;
  const cur = s.accountCurrency || 'USD';
  const mode = ctx.calcMode || 'plan';
  const specs = { ...(s.customInstruments || {}) };
  const instruments = [...new Set([...DEFAULT_INSTRUMENTS.map((d) => d.symbol), ...Object.keys(specs)])];

  view.innerHTML = `
    <h1>Calculator</h1>
    <div class="segmented" role="group" aria-label="Mode">
      <button data-mode="plan" aria-pressed="${mode === 'plan'}">Trade planning</button>
      <button data-mode="size" aria-pressed="${mode === 'size'}">Position sizing</button>
    </div>
    <div class="card" id="calc-form"></div>
    <div class="card" id="calc-out"><p class="muted small">Enter values to see an estimate.</p></div>
    <p class="small muted">All outputs are estimates from configured instrument specs. Actual broker values differ (contract size, pip size, commissions, spreads, conversion rates).</p>`;

  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { ctx.calcMode = b.dataset.mode; renderCalculator(view, ctx); }));
  const form = view.querySelector('#calc-form');
  const out = view.querySelector('#calc-out');

  if (mode === 'plan') {
    form.innerHTML = `<div class="grid2">
      <div class="field"><label>Instrument</label><input list="cl" id="p-sym" value="EURUSD"/><datalist id="cl">${instruments.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field"><label>Account currency</label><input id="p-cur" value="${esc(cur)}" maxlength="3"/></div>
      <div class="field"><label>Direction</label><select id="p-dir"><option value="long">long</option><option value="short">short</option></select></div>
      <div class="field"><label>Lots</label><input id="p-lots" inputmode="decimal" value="0.10"/></div>
      <div class="field"><label>Entry</label><input id="p-entry" inputmode="decimal"/></div>
      <div class="field"><label>Stop loss</label><input id="p-sl" inputmode="decimal"/></div>
      <div class="field"><label>Take profit</label><input id="p-tp" inputmode="decimal"/></div>
      <div class="field"><label>Quote→account rate (if needed)</label><input id="p-rate" inputmode="decimal" placeholder="optional"/></div>
    </div><button class="btn primary" id="calc-go">Calculate</button>`;
    form.querySelector('#calc-go').addEventListener('click', () => {
      const v = (id) => form.querySelector('#' + id).value;
      const r = planTrade({ symbol: v('p-sym'), accountCurrency: v('p-cur'), direction: v('p-dir'), lots: v('p-lots'), entry: v('p-entry'), stopLoss: v('p-sl'), takeProfit: v('p-tp'), rate: v('p-rate') }, specs);
      out.innerHTML = renderPlan(r, cur);
    });
  } else {
    form.innerHTML = `<div class="grid2">
      <div class="field"><label>Instrument</label><input list="cl" id="s-sym" value="EURUSD"/><datalist id="cl">${instruments.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field"><label>Account currency</label><input id="s-cur" value="${esc(cur)}" maxlength="3"/></div>
      <div class="field"><label>Balance</label><input id="s-bal" inputmode="decimal" value="${esc(s.startingBalance ?? '')}"/></div>
      <div class="field"><label>Risk %</label><input id="s-risk" inputmode="decimal" value="1"/></div>
      <div class="field"><label>Entry</label><input id="s-entry" inputmode="decimal"/></div>
      <div class="field"><label>Stop loss</label><input id="s-sl" inputmode="decimal"/></div>
      <div class="field"><label>Take profit (optional)</label><input id="s-tp" inputmode="decimal"/></div>
      <div class="field"><label>Quote→account rate (if needed)</label><input id="s-rate" inputmode="decimal" placeholder="optional"/></div>
    </div><button class="btn primary" id="calc-go">Calculate</button>`;
    form.querySelector('#calc-go').addEventListener('click', () => {
      const v = (id) => form.querySelector('#' + id).value;
      const r = sizePosition({ symbol: v('s-sym'), accountCurrency: v('s-cur'), balance: v('s-bal'), riskPercent: v('s-risk'), entry: v('s-entry'), stopLoss: v('s-sl'), takeProfit: v('s-tp'), rate: v('s-rate') }, specs);
      out.innerHTML = renderSize(r, cur);
    });
  }
}

function renderPlan(r, cur) {
  if (!r.ok) return `<div class="notice error">${(r.errors || []).map(esc).join('<br>')}</div>`;
  const x = r.result;
  return `<h3>Estimate</h3><div class="table-list">
    <div class="line"><span>SL distance</span><span>${x.slPips} pips</span></div>
    <div class="line"><span>TP distance</span><span>${x.tpPips ?? '—'} pips</span></div>
    <div class="line"><span>Risk</span><span class="neg">${money(-x.riskMoney, cur)}</span></div>
    <div class="line"><span>Reward</span><span class="pos">${x.rewardMoney == null ? '—' : money(x.rewardMoney, cur)}</span></div>
    <div class="line"><span>Planned RR</span><span>${x.plannedRR ?? '—'}</span></div>
    <div class="line"><span>Est. commission</span><span>${money(x.estCommission, cur)}</span></div>
  </div>${(r.warnings || []).map((w) => `<p class="small muted">⚠ ${esc(w)}</p>`).join('')}`;
}

function renderSize(r, cur) {
  if (!r.ok) return `<div class="notice error">${(r.errors || []).map(esc).join('<br>')}</div>`;
  const x = r.result;
  return `<h3>Estimate</h3><div class="table-list">
    <div class="line"><span>Risk amount</span><span class="neg">${money(-x.riskAmount, cur)}</span></div>
    <div class="line"><span>Suggested size</span><span>${x.suggestedLots} lots (raw ${x.rawLots})</span></div>
    <div class="line"><span>Reward (if TP)</span><span class="pos">${x.rewardMoney == null ? '—' : money(x.rewardMoney, cur)}</span></div>
    <div class="line"><span>Planned RR (if TP)</span><span>${x.plannedRR ?? '—'}</span></div>
  </div>${(r.warnings || []).map((w) => `<p class="small muted">⚠ ${esc(w)}</p>`).join('')}`;
}
