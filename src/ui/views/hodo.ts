/** Вкладка «Годограф»: траєкторії Z(t) петель на площині R-X, зони ДЗ, моменти входу в зони. */
import { impedanceTrace, LOOPS, PE_LOOPS, type ImpedanceTrace, type LoopId } from '../../analysis/compute';
import { bayRatios } from '../../analysis/bay';
import { buildZones, pointInPolygon, zonePolygon, type Pt, type Zone } from '../../analysis/zones';
import { sampleAt } from '../../model/record';
import { fmt } from '../../model/units';
import { checkbox, h, numberInput } from '../dom';
import { absFromMs, bayPhasors, displayScale, LOOP_COLORS, msRel } from '../analysis';
import { baseLayout, draw } from '../plot';
import { compensationOf, currentBay, currentSettings, lineZ1, state } from '../state';

const ZONE_COLORS = ['#1f5fbf', '#2e8b3a', '#c26a00', '#7b3fa0', '#b0306a', '#0f8a8a', '#5b6773'];

export interface HodoResult {
  traces: ImpedanceTrace[];
  zones: { zone: Zone; poly: Pt[]; color: string }[];
  entries: { zone: string; family: string; loop: LoopId; tMs: number | null; timeS?: number }[];
}

/** Зони поточного приєднання, переведені в одиниці відображення. */
export function displayZones(): { zone: Zone; poly: Pt[]; color: string }[] {
  const grid = state.grid;
  const bay = currentBay();
  if (!grid || !bay) return [];
  const s = currentSettings();
  const r = bayRatios(grid.rec, bay);
  const kz = r.ct / r.vt; // Zвт = Zперв · Kтс / Kтн
  const zones = [...s.zones.flatMap(buildZones), ...s.rioZones];
  return zones
    .filter((z) => z.enabled)
    .map((z, i) => {
      const toDisp = z.units === state.units ? 1 : state.units === 'sec' ? kz : 1 / kz;
      return { zone: z, poly: zonePolygon(z).map(([x, y]) => [x * toDisp, y * toDisp] as Pt), color: z.color ?? ZONE_COLORS[i % ZONE_COLORS.length] };
    });
}

export function computeHodograph(): HodoResult | null {
  const grid = state.grid;
  const bay = currentBay();
  const bp = bayPhasors();
  if (!grid || !bay || !bp || !bp.hasI || !bp.hasU) return null;
  const rec = grid.rec;
  const s = currentSettings();
  const comp = compensationOf(s.line);
  const sc = displayScale();
  const iNom = bay.i.a !== null ? rec.analog[bay.i.a].primary : 1;
  const iMin = (s.line.iMinPct / 100) * iNom;
  const k1 = sampleAt(rec, absFromMs(state.hodoFromMs));
  const k2 = sampleAt(rec, absFromMs(state.hodoToMs));
  const traces = state.loops.map((l) => impedanceTrace(bp, l, comp, rec.time, k1, k2, iMin, sc.z));
  const zones = displayZones();
  const entries: HodoResult['entries'] = [];
  for (const z of zones) {
    for (const tr of traces) {
      const fam = PE_LOOPS.includes(tr.loop) ? 'pe' : 'pp';
      if (fam !== z.zone.family) continue;
      let tMs: number | null = null;
      for (let i = 0; i < tr.r.length; i++) {
        if (pointInPolygon([tr.r[i], tr.x[i]], z.poly)) {
          tMs = msRel(tr.t[i]);
          break;
        }
      }
      entries.push({ zone: z.zone.name, family: fam, loop: tr.loop, tMs, timeS: z.zone.timeS });
    }
  }
  return { traces, zones, entries };
}

export function hodographFigure(res: HodoResult, forPrint = false): [Plotly.Data[], Partial<Plotly.Layout>] {
  const sc = displayScale();
  const s = currentSettings();
  const data: Plotly.Data[] = [];
  for (const z of res.zones) {
    const p = [...z.poly, z.poly[0]];
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: p.map((q) => q[0]),
      y: p.map((q) => q[1]),
      name: `${z.zone.name} (${z.zone.family === 'pp' ? 'ф-ф' : 'ф-з'})`,
      line: { color: z.color, width: 1.4, dash: z.zone.family === 'pe' ? 'dash' : 'solid' },
      fill: 'toself',
      fillcolor: z.color + '14',
      hoverinfo: 'name',
    } as Plotly.Data);
  }
  const zl = lineZ1(s.line);
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: [0, zl.re * sc.z],
    y: [0, zl.im * sc.z],
    name: `Z1 лінії (${fmt(s.line.lengthKm, 4)} км)`,
    line: { color: '#333', width: 2 },
  } as Plotly.Data);
  const kAbs = state.grid ? sampleAt(state.grid.rec, state.tA) : -1;
  for (const tr of res.traces) {
    if (!tr.r.length) continue;
    data.push({
      type: 'scatter',
      mode: forPrint ? 'lines' : 'lines+markers',
      x: tr.r,
      y: tr.x,
      name: `Z${tr.loop}`,
      line: { color: LOOP_COLORS[tr.loop], width: 1.6 },
      marker: { size: 3 },
      customdata: tr.t.map((t) => msRel(t)),
      hovertemplate: `Z${tr.loop}: R = %{x:.3f}, X = %{y:.3f} ${sc.zUnit}<br>t = %{customdata:.1f} мс<extra></extra>`,
    } as Plotly.Data);
    const i = tr.k.indexOf(kAbs);
    if (i >= 0) {
      data.push({
        type: 'scatter',
        mode: 'markers',
        x: [tr.r[i]],
        y: [tr.x[i]],
        showlegend: false,
        marker: { size: 10, color: LOOP_COLORS[tr.loop], line: { color: '#fff', width: 1.5 } },
        hovertemplate: `Z${tr.loop} у момент А<extra></extra>`,
      } as Plotly.Data);
    }
  }
  // Межі за замовчуванням: лінія, зони та основна частина траєкторій (без точок режиму навантаження).
  const zLine = Math.hypot(zl.re, zl.im) * sc.z;
  let lim = zLine * 1.3;
  for (const z of res.zones) for (const p of z.poly) lim = Math.max(lim, Math.abs(p[0]) * 1.15, Math.abs(p[1]) * 1.15);
  const mags = res.traces.flatMap((t) => t.r.map((r, i) => Math.hypot(r, t.x[i]))).sort((a, b) => a - b);
  if (mags.length) lim = Math.max(lim, Math.min(mags[Math.floor(mags.length * 0.6)] * 1.1, zLine * 3));
  if (!Number.isFinite(lim) || lim <= 0) lim = 10;
  const layout: Partial<Plotly.Layout> = {
    ...baseLayout(),
    height: forPrint ? 620 : 640,
    xaxis: { title: { text: `R, ${sc.zUnit}` }, range: [-lim * 0.8, lim], zeroline: true, zerolinewidth: 1.5, gridcolor: (baseLayout().xaxis as { gridcolor: string }).gridcolor },
    yaxis: { title: { text: `X, ${sc.zUnit}` }, range: [-lim * 0.5, lim * 1.1], scaleanchor: 'x', scaleratio: 1, zeroline: true, zerolinewidth: 1.5, gridcolor: (baseLayout().yaxis as { gridcolor: string }).gridcolor },
    legend: { orientation: 'v', x: 1.02, y: 1 },
    margin: { l: 70, r: 160, t: 20, b: 50 },
  };
  return [data, layout];
}

export function renderHodo(root: HTMLElement, rerender: () => void): void {
  const bay = currentBay();
  if (!bay) {
    root.append(h('p', { class: 'muted pad' }, 'Призначте канали приєднання на вкладці «Дані».'));
    return;
  }
  const s = currentSettings();
  const controls = h(
    'div',
    { class: 'row' },
    h('label', {}, 'Інтервал, мс від пуску: від ', numberInput(state.hodoFromMs, (v) => {
      state.hodoFromMs = v;
      rerender();
    }, { class: 'num' }), ' до ', numberInput(state.hodoToMs, (v) => {
      state.hodoToMs = v;
      rerender();
    }, { class: 'num' })),
    h('span', { class: 'sep' }),
    ...LOOPS.map((l) =>
      checkbox(`Z${l}`, state.loops.includes(l), (on) => {
        state.loops = on ? LOOPS.filter((x) => x === l || state.loops.includes(x)) : state.loops.filter((x) => x !== l);
        rerender();
      }),
    ),
    h('span', { class: 'sep' }),
    h('label', {}, 'Iмін, % Iном ТС: ', numberInput(s.line.iMinPct, (v) => {
      s.line.iMinPct = v;
      rerender();
    }, { class: 'num' })),
  );
  const res = computeHodograph();
  if (!res) {
    root.append(controls, h('p', { class: 'warn' }, 'Для годографа потрібні три фазні струми та три фазні напруги приєднання.'));
    return;
  }
  const comp = compensationOf(s.line);
  const compText =
    comp.mode === 'k0'
      ? `k0 = ${fmt(Math.hypot(comp.k0.re, comp.k0.im), 4)} ∠ ${fmt((Math.atan2(comp.k0.im, comp.k0.re) * 180) / Math.PI, 4)}°`
      : `RE/RL = ${fmt(comp.rerl, 4)}, XE/XL = ${fmt(comp.xexl, 4)}`;
  const plotDiv = h('div', { class: 'plot' });
  root.append(
    controls,
    h('p', { class: 'muted' }, `Петлі ф-з обчислюються з компенсацією ${compText}${comp.useMutual ? ' та взаємоіндукції паралельної лінії' : ''}. Великий маркер — момент курсора А (${fmt(msRel(state.tA), 4)} мс). Параметри лінії та зони — на вкладці «Уставки».`),
    plotDiv,
    entriesTable(res),
  );
  const [data, layout] = hodographFigure(res);
  draw(plotDiv, data, layout);
}

function entriesTable(res: HodoResult): HTMLElement {
  if (!res.zones.length) return h('p', { class: 'muted' }, 'Зони не задано.');
  const byZone = new Map<string, HodoResult['entries']>();
  for (const e of res.entries) {
    const key = `${e.zone} (${e.family === 'pp' ? 'ф-ф' : 'ф-з'})`;
    if (!byZone.has(key)) byZone.set(key, []);
    byZone.get(key)!.push(e);
  }
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Перший вхід траєкторії в зону, мс від пуску'),
    h(
      'table',
      { class: 'grid compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Зона'), h('th', {}, 'tуст, с'), ...state.loops.map((l) => h('th', {}, `Z${l}`)))),
      h(
        'tbody',
        {},
        [...byZone.entries()].map(([name, es]) =>
          h(
            'tr',
            {},
            h('th', {}, name),
            h('td', {}, es[0]?.timeS !== undefined ? fmt(es[0].timeS, 3) : '—'),
            ...state.loops.map((l) => {
              const e = es.find((x) => x.loop === l);
              return h('td', {}, e ? (e.tMs === null ? '—' : fmt(e.tMs, 4)) : '');
            }),
          ),
        ),
      ),
    ),
    h('p', { class: 'muted' }, 'Час входу визначено за обраним фільтром програми; фактичний час спрацювання термінала залежить від його алгоритму, витримок та логіки — висновок робиться лише з урахуванням журналу подій термінала.'),
  );
}
