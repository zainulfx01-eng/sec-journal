// Discipline tracker (descriptive pattern summary) and per-date daily reflection journal.
import { esc, money, toast, confirmDialog, $ } from './ui.js';
import { discipline, dayKey, isDayKey, DISCIPLINE_NOTE, validateReflection, WEEKDAYS } from './insights.js';
import { REFLECTION_FIELDS, MAX_REFLECTION } from './config.js';

const PLAN_LABEL = { yes: 'followed', partial: 'partly followed', no: 'not followed', unset: 'not recorded' };

export function renderDiscipline(el, ctx, todayKey) {
  if (!el) return;
  const trades = ctx.store.state.trades;
  const cur = ctx.store.state.settings.accountCurrency || 'USD';
  const d = discipline(trades);
  const dateSel = ctx.reflectionDate && isDayKey(ctx.reflectionDate) ? ctx.reflectionDate : todayKey;
  const entry = (ctx.store.state.reflections || {})[dateSel] || null;
  const dates = Object.keys(ctx.store.state.reflections || {}).sort().reverse();

  el.innerHTML = `
    <p class="small muted">${esc(DISCIPLINE_NOTE)}</p>
    <div class="card"><h3>Plan followed</h3>
      <div class="kv">${['yes', 'partial', 'no', 'unset'].map((p) => `<div class="line"><span class="muted">${PLAN_LABEL[p]}</span><span>${d.planCounts[p]} trade${d.planCounts[p] === 1 ? '' : 's'}</span></div>`).join('')}</div>
      <table class="mini-table"><thead><tr><th>Plan</th><th>Closed</th><th>Win rate</th><th>Net</th></tr></thead><tbody>
        ${d.planOutcomes.map((r) => `<tr><td>${PLAN_LABEL[r.plan]}</td><td>${r.n}</td><td>${r.winRate == null ? '—' : r.winRate + '%'}</td><td class="${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${r.n ? money(r.net, cur, { sign: true }) : '—'}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card"><h3>Rule violations (plan not fully followed)</h3>
      <div class="kv">
        ${vio('Winning trades', d.violations.winners)}
        ${vio('Losing trades', d.violations.losers)}
        ${vio('Break-even trades', d.violations.breakeven)}
      </div>
      <p class="small muted">Share of trades with a recorded plan that was partly or not followed. Describes what you recorded, not why trades won or lost.</p>
    </div>
    <div class="card"><h3>Most common mistakes</h3>
      ${tagList(d.mistakes, 'No mistakes recorded yet. Add them in a trade\'s "Mistakes" field (comma separated).')}
    </div>
    <div class="card"><h3>Emotion tags</h3>
      ${tagList(d.emotions, 'No emotions recorded yet. Add them in the trade\'s emotion fields.')}
    </div>
    <div class="card"><h3>Coverage</h3>
      <div class="kv">
        ${kvl('Trades total', d.totalTrades)}
        ${kvl('Trades with mistakes noted', d.notes.withMistakes)}
        ${kvl('Trades with a lesson', d.notes.withLessons)}
        ${kvl('Trades with emotions noted', d.notes.withEmotions)}
      </div>
    </div>
    <div class="card" id="refl">
      <h3>Daily reflection</h3>
      <div class="line"><label class="small muted" for="refl-date">Date</label><input type="date" id="refl-date" value="${esc(dateSel)}"/></div>
      <form id="refl-form" novalidate>
        ${REFLECTION_FIELDS.map((f) => `<div class="field" data-field="${f.key}"><label for="rf-${f.key}">${esc(f.label)}</label>
          <textarea id="rf-${f.key}" name="${f.key}" rows="2" maxlength="${MAX_REFLECTION}">${esc(entry ? entry[f.key] : '')}</textarea>
          <div class="error" data-err="${f.key}"></div></div>`).join('')}
        <div class="error" data-err="_form"></div>
        <div class="row" style="justify-content:flex-end;gap:8px">
          ${entry ? '<button type="button" class="btn danger" id="refl-del">Delete this day</button>' : ''}
          <button type="submit" class="btn primary">Save reflection</button>
        </div>
      </form>
      <p class="small muted">Stored on this device only until Stage 3 (Supabase). Dates with an entry: ${dates.length ? dates.slice(0, 12).map((k) => `<button class="chip" data-jump="${k}">${esc(k)}</button>`).join(' ') : 'none yet'}</p>
    </div>`;

  el.querySelector('#refl-date').addEventListener('change', (e) => {
    if (!isDayKey(e.target.value)) return toast('Pick a valid date.');
    ctx.reflectionDate = e.target.value;
    renderDiscipline(el, ctx, todayKey);
  });
  el.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { ctx.reflectionDate = b.dataset.jump; renderDiscipline(el, ctx, todayKey); }));

  el.querySelector('#refl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = Object.fromEntries(REFLECTION_FIELDS.map((f) => [f.key, el.querySelector(`#rf-${f.key}`).value]));
    const v = validateReflection(dateSel, raw);
    el.querySelectorAll('[data-err]').forEach((x) => { x.textContent = ''; });
    if (!v.valid) {
      for (const [k, msg] of Object.entries(v.errors)) { const n = el.querySelector(`[data-err="${k}"]`); if (n) n.textContent = msg; }
      return;
    }
    const r = ctx.store.setReflection(dateSel, raw);
    if (!r.ok) {
      const msg = r.errors ? Object.values(r.errors).join(' ') : 'Could not save.';
      el.querySelector('[data-err="_form"]').textContent = msg;
      return;
    }
    toast('Reflection saved');
    renderDiscipline(el, ctx, todayKey);
  });

  const del = el.querySelector('#refl-del');
  if (del) del.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this day\'s reflection?', `This removes the reflection for ${dateSel} from this device.`))) return;
    ctx.store.deleteReflection(dateSel);
    toast('Reflection deleted');
    renderDiscipline(el, ctx, todayKey);
  });
  void WEEKDAYS; void dayKey; void $;
}

function vio(label, v) {
  return `<div class="line"><span class="muted">${esc(label)}</span><span>${v.notFollowed} of ${v.recorded} recorded ${v.rate == null ? '' : '(' + v.rate + '%)'}</span></div>`;
}
function kvl(label, value) {
  return `<div class="line"><span class="muted">${esc(label)}</span><span>${esc(String(value))}</span></div>`;
}
function tagList(rows, empty) {
  if (!rows.length) return `<p class="muted small">${esc(empty)}</p>`;
  return rows.map((r) => `<div class="line"><span>${esc(r.tag)}</span><span class="small muted">${r.count}× · ${r.onWinners} on winners · ${r.onLosers} on losers</span></div>`).join('')
    + '<p class="small muted">Counts show how often a tag appears, and on which kinds of trades. They do not show what caused the result.</p>';
}
