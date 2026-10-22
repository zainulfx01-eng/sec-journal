// Lightweight SVG equity curve with tap-to-inspect points. No dependencies, no CDN.
import { esc, money } from './ui.js';

export function equityChart(el, curve, currency) {
  if (!el) return;
  if (!curve || curve.length < 2) {
    el.innerHTML = '<p class="muted small">Close at least one trade to plot the equity curve.</p>';
    return;
  }
  const W = 600, H = 220, P = 28;
  const ys = curve.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => P + (i / (curve.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - P * 2);
  const pts = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const zeroY = min < 0 && max > 0 ? y(0) : null;
  const last = curve[curve.length - 1];
  const color = last.y >= curve[0].y ? 'var(--profit)' : 'var(--loss)';
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Equity curve">
    ${zeroY != null ? `<line x1="${P}" x2="${W - P}" y1="${zeroY}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="4 4"/>` : ''}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${curve.map((p, i) => `<circle data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4" fill="${color}" style="cursor:pointer"/>`).join('')}
    <text x="${P}" y="${H - 6}">${esc(String(min.toFixed(0)))}</text>
    <text x="${P}" y="12">${esc(String(max.toFixed(0)))}</text>
  </svg><div class="tooltip hidden" id="eq-tip"></div>`;
  const tip = el.querySelector('#eq-tip');
  el.querySelectorAll('circle').forEach((c) => c.addEventListener('click', () => {
    const p = curve[Number(c.dataset.i)];
    tip.classList.remove('hidden');
    tip.textContent = `${p.label === 'Start' ? 'Start balance' : p.label}: balance ${money(p.y, currency)}${p.pl ? ' (trade ' + money(p.pl, currency, { sign: true }) + ')' : ''}`;
  }));
}
