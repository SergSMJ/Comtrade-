/** Вкладка «Вектори»: векторні діаграми U та I у моменти А і В, симетричні складові, аварійні складові. */
import { abs, arg, deg, div, scale, sub, wrapDeg, type C } from '../../dsp/complex';
import { at, sequence, type BayPhasors } from '../../analysis/compute';
import { fmt } from '../../model/units';
import { checkbox, h, select } from '../dom';
import { bayPhasors, displayScale, kA, kB, msRel, PHASE_COLORS } from '../analysis';
import { baseLayout, draw } from '../plot';
import { currentBay, state } from '../state';

interface Vec {
  key: string;
  label: string;
  v: C;
  kind: 'U' | 'I';
  color: string;
  group: 'phase' | 'line' | 'seq';
}

const SEQ_COLORS = { 1: '#6b4fd8', 2: '#b0306a', 0: '#5b6773' };

export function vectorsAt(bp: BayPhasors, k: number): Vec[] {
  const ua = at(bp.ua, k);
  const ub = at(bp.ub, k);
  const uc = at(bp.uc, k);
  const ia = at(bp.ia, k);
  const ib = at(bp.ib, k);
  const ic = at(bp.ic, k);
  const su = sequence(ua, ub, uc);
  const si = sequence(ia, ib, ic);
  const out: Vec[] = [];
  if (bp.hasU) {
    out.push(
      { key: 'ua', label: 'Ua', v: ua, kind: 'U', color: PHASE_COLORS.a, group: 'phase' },
      { key: 'ub', label: 'Ub', v: ub, kind: 'U', color: PHASE_COLORS.b, group: 'phase' },
      { key: 'uc', label: 'Uc', v: uc, kind: 'U', color: PHASE_COLORS.c, group: 'phase' },
      { key: 'un', label: bp.unMeasured ? '3U0 (вимір.)' : '3U0 (сума)', v: at(bp.un, k), kind: 'U', color: PHASE_COLORS.n, group: 'phase' },
      { key: 'uab', label: 'Uab', v: sub(ua, ub), kind: 'U', color: '#b5651d', group: 'line' },
      { key: 'ubc', label: 'Ubc', v: sub(ub, uc), kind: 'U', color: '#7b3fa0', group: 'line' },
      { key: 'uca', label: 'Uca', v: sub(uc, ua), kind: 'U', color: '#0f8a8a', group: 'line' },
      { key: 'u1', label: 'U1', v: su.x1, kind: 'U', color: SEQ_COLORS[1], group: 'seq' },
      { key: 'u2', label: 'U2', v: su.x2, kind: 'U', color: SEQ_COLORS[2], group: 'seq' },
      { key: 'u0', label: 'U0', v: su.x0, kind: 'U', color: SEQ_COLORS[0], group: 'seq' },
    );
  }
  if (bp.hasI) {
    out.push(
      { key: 'ia', label: 'Ia', v: ia, kind: 'I', color: PHASE_COLORS.a, group: 'phase' },
      { key: 'ib', label: 'Ib', v: ib, kind: 'I', color: PHASE_COLORS.b, group: 'phase' },
      { key: 'ic', label: 'Ic', v: ic, kind: 'I', color: PHASE_COLORS.c, group: 'phase' },
      { key: 'in', label: bp.inMeasured ? '3I0 (вимір.)' : '3I0 (сума)', v: at(bp.in, k), kind: 'I', color: PHASE_COLORS.n, group: 'phase' },
      { key: 'iab', label: 'Ia−Ib', v: sub(ia, ib), kind: 'I', color: '#b5651d', group: 'line' },
      { key: 'ibc', label: 'Ib−Ic', v: sub(ib, ic), kind: 'I', color: '#7b3fa0', group: 'line' },
      { key: 'ica', label: 'Ic−Ia', v: sub(ic, ia), kind: 'I', color: '#0f8a8a', group: 'line' },
      { key: 'i1', label: 'I1', v: si.x1, kind: 'I', color: SEQ_COLORS[1], group: 'seq' },
      { key: 'i2', label: 'I2', v: si.x2, kind: 'I', color: SEQ_COLORS[2], group: 'seq' },
      { key: 'i0', label: 'I0', v: si.x0, kind: 'I', color: SEQ_COLORS[0], group: 'seq' },
    );
  }
  return out;
}

export const REF_OPTIONS = [
  { value: 'ua', label: 'Ua' },
  { value: 'ub', label: 'Ub' },
  { value: 'uc', label: 'Uc' },
  { value: 'uab', label: 'Uab' },
  { value: 'u1', label: 'U1' },
  { value: 'ia', label: 'Ia' },
  { value: 'i1', label: 'I1' },
  { value: 'none', label: 'без повороту' },
];

export function referenceAngle(vecs: Vec[]): number {
  const r = vecs.find((v) => v.key === state.vectorRef);
  return r && abs(r.v) > 0 ? arg(r.v) : 0;
}

function polarFigure(title: string, vA: Vec[], vB: Vec[], refA: number, refB: number, k: number, unit: string): [Plotly.Data[], Partial<Plotly.Layout>] {
  const data: Plotly.Data[] = [];
  const tr = (v: Vec, ref: number, ghost: boolean) => {
    const m = abs(v.v) * k;
    const a = wrapDeg(deg(arg(v.v) - ref));
    data.push({
      type: 'scatterpolar',
      mode: 'lines+markers',
      r: [0, m],
      theta: [0, a],
      name: ghost ? `${v.label} (В)` : v.label,
      legendgroup: v.key,
      showlegend: !ghost,
      line: { color: v.color, width: ghost ? 1.5 : 2.6, dash: ghost ? 'dot' : 'solid' },
      marker: { size: [0, ghost ? 6 : 9], symbol: 'triangle-up', angleref: 'previous', color: v.color, opacity: ghost ? 0.6 : 1 },
      hovertemplate: `${v.label}${ghost ? ' (В)' : ''}: ${fmt(m, 4)} ${unit} ∠ ${fmt(a, 4)}°<extra></extra>`,
    } as Plotly.Data);
  };
  vA.forEach((v) => tr(v, refA, false));
  vB.forEach((v) => tr(v, refB, true));
  const layout: Partial<Plotly.Layout> = {
    ...baseLayout(),
    title: { text: title, font: { size: 13 } },
    height: 440,
    margin: { l: 40, r: 40, t: 50, b: 40 },
    legend: { orientation: 'h', y: -0.05 },
    polar: {
      angularaxis: { direction: 'counterclockwise', rotation: 0, dtick: 30, gridcolor: (baseLayout().xaxis as { gridcolor: string }).gridcolor },
      radialaxis: { angle: 90, tickangle: 90, ticksuffix: ` ${unit}`, gridcolor: (baseLayout().xaxis as { gridcolor: string }).gridcolor },
      bgcolor: (baseLayout().plot_bgcolor as string) ?? undefined,
    },
  };
  return [data, layout];
}

export function renderVectors(root: HTMLElement, rerender: () => void): void {
  const bp = bayPhasors();
  const bay = currentBay();
  if (!bp || !bay) {
    root.append(h('p', { class: 'muted pad' }, 'Призначте канали приєднання на вкладці «Дані».'));
    return;
  }
  const sc = displayScale();
  const a = kA();
  const b = kB();
  const vecsA = vectorsAt(bp, a);
  const vecsB = vectorsAt(bp, b);
  const refA = state.vectorRef === 'none' ? 0 : referenceAngle(vecsA);
  const refB = state.vectorRef === 'none' ? 0 : referenceAngle(vecsB);
  const groups = (['phase', 'line', 'seq'] as const).filter((g) => state.vectorSets[g]);
  const pick = (vs: Vec[], kind: 'U' | 'I') => vs.filter((v) => v.kind === kind && groups.includes(v.group));

  const controls = h(
    'div',
    { class: 'row' },
    h('label', {}, 'Опорний вектор (0°): ', select(REF_OPTIONS, state.vectorRef, (v) => {
      state.vectorRef = v;
      rerender();
    })),
    checkbox('фазні', state.vectorSets.phase, (v) => {
      state.vectorSets.phase = v;
      rerender();
    }),
    checkbox('лінійні / петлеві', state.vectorSets.line, (v) => {
      state.vectorSets.line = v;
      rerender();
    }),
    checkbox('симетричні складові', state.vectorSets.seq, (v) => {
      state.vectorSets.seq = v;
      rerender();
    }),
    checkbox('накласти момент В', state.vectorSets.compareB, (v) => {
      state.vectorSets.compareB = v;
      rerender();
    }),
  );

  const notValid = a < bp.valid ? h('p', { class: 'warn' }, 'Курсор А стоїть до заповнення вікна фільтра — вектори недостовірні.') : null;
  const plots = h('div', { class: 'cols2' });
  const pu = h('div', { class: 'plot' });
  const pi = h('div', { class: 'plot' });
  plots.append(pu, pi);
  root.append(controls, notValid ?? '', plots, tables(vecsA, vecsB, refA, refB, sc), sequenceTable(bp, a, b, sc));

  const showB = state.vectorSets.compareB;
  const [du, lu] = polarFigure(`Напруги · А = ${fmt(msRel(state.tA), 4)} мс${showB ? ` · В = ${fmt(msRel(state.tB), 4)} мс` : ''}`, pick(vecsA, 'U'), showB ? pick(vecsB, 'U') : [], refA, refB, sc.u, sc.uUnit);
  const [di, li] = polarFigure(`Струми · А = ${fmt(msRel(state.tA), 4)} мс${showB ? ` · В = ${fmt(msRel(state.tB), 4)} мс` : ''}`, pick(vecsA, 'I'), showB ? pick(vecsB, 'I') : [], refA, refB, sc.i, sc.iUnit);
  draw(pu, du, lu);
  draw(pi, di, li);
}

function tables(vA: Vec[], vB: Vec[], refA: number, refB: number, sc: ReturnType<typeof displayScale>): HTMLElement {
  const row = (v: Vec, w: Vec | undefined) => {
    const k = v.kind === 'U' ? sc.u : sc.i;
    const unit = v.kind === 'U' ? sc.uUnit : sc.iUnit;
    const d = w ? sub(v.v, w.v) : undefined;
    return h(
      'tr',
      {},
      h('th', { style: `color:${v.color}` }, v.label),
      h('td', {}, `${fmt(abs(v.v) * k, 4)} ${unit}`),
      h('td', {}, `${fmt(wrapDeg(deg(arg(v.v) - refA)), 4)}°`),
      h('td', {}, w ? `${fmt(abs(w.v) * k, 4)} ${unit}` : '—'),
      h('td', {}, w ? `${fmt(wrapDeg(deg(arg(w.v) - refB)), 4)}°` : '—'),
      h('td', {}, d ? `${fmt(abs(d) * k, 4)} ${unit}` : '—'),
      h('td', {}, d ? `${fmt(wrapDeg(deg(arg(d) - refA)), 4)}°` : '—'),
    );
  };
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Значення векторів (діючі значення 1-ї гармоніки)'),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'grid' },
        h('thead', {}, h('tr', {}, ['Величина', '|А|', '∠А', '|В|', '∠В', '|Δ = А−В|', '∠Δ'].map((t) => h('th', {}, t)))),
        h('tbody', {}, vA.map((v) => row(v, vB.find((w) => w.key === v.key)))),
      ),
    ),
    h('p', { class: 'muted' }, 'Кути відраховуються від опорного вектора в кожний момент окремо; Δ — аварійна складова (кут Δ — від опорного вектора моменту А).'),
  );
}

function sequenceTable(bp: BayPhasors, a: number, b: number, sc: ReturnType<typeof displayScale>): HTMLElement {
  const rows: HTMLElement[] = [];
  const add = (label: string, x: number, unit: string) => rows.push(h('tr', {}, h('th', {}, label), h('td', {}, Number.isFinite(x) ? `${fmt(x, 4)} ${unit}` : '—')));
  for (const [name, k] of [['А', a], ['В', b]] as const) {
    if (!bp.hasU || !bp.hasI) break;
    const su = sequence(at(bp.ua, k), at(bp.ub, k), at(bp.uc, k));
    const si = sequence(at(bp.ia, k), at(bp.ib, k), at(bp.ic, k));
    const i1 = abs(si.x1);
    add(`${name}: I2/I1`, i1 > 0 ? abs(si.x2) / i1 : NaN, '');
    add(`${name}: I0/I1`, i1 > 0 ? abs(si.x0) / i1 : NaN, '');
    add(`${name}: U2/U1`, abs(su.x1) > 0 ? abs(su.x2) / abs(su.x1) : NaN, '');
    add(`${name}: ∠(U2/I2), °`, abs(si.x2) > 0 ? wrapDeg(deg(arg(div(su.x2, si.x2)))) : NaN, '');
    add(`${name}: ∠(U0/I0), °`, abs(si.x0) > 0 ? wrapDeg(deg(arg(div(su.x0, si.x0)))) : NaN, '');
    add(`${name}: Z1 = U1/I1`, i1 > 0 ? abs(scale(div(su.x1, si.x1), sc.z)) : NaN, sc.zUnit);
  }
  return h('section', { class: 'card' }, h('h2', {}, 'Співвідношення симетричних складових'), h('table', { class: 'grid compact' }, h('tbody', {}, rows)));
}
