/** Вкладка «Осцилограми»: миттєві та діючі значення, дискретні сигнали, курсори А/В. */
import { SLOTS, type PhaseSlot } from '../../analysis/bay';
import { checkbox, h } from '../dom';
import { absFromMs, bayPhasors, channelScale, displayScale, msRel, PHASE_COLORS } from '../analysis';
import { baseLayout, plotConfig, Plotly } from '../plot';
import { currentBay, state } from '../state';
import type { PhasorSeries } from '../../dsp/phasor';

interface Panel {
  title: string;
  unit: string;
  traces: { name: string; x: number[]; y: Float64Array | number[]; color?: string; dash?: string }[];
}

export function renderOsc(root: HTMLElement, rerender: () => void, onCursor: () => void): void {
  const grid = state.grid;
  if (!grid) return;
  const rec = grid.rec;
  const bay = currentBay();
  const xs = Array.from(rec.time, (t) => msRel(t));

  const bayIdx = new Set<number>();
  if (bay) for (const s of SLOTS) for (const set of ['i', 'u'] as const) if (bay[set][s] !== null) bayIdx.add(bay[set][s]!);

  const panels: Panel[] = [];
  const sc = displayScale();
  const bp = bayPhasors();
  const rmsTrace = (p: PhasorSeries, k: number) => Array.from(p.re, (re, i) => Math.hypot(re, p.im[i]) * k);

  if (bay) {
    for (const set of ['i', 'u'] as const) {
      const isI = set === 'i';
      const panel: Panel = { title: `${isI ? 'Струми' : 'Напруги'} · ${bay.name}`, unit: isI ? sc.iUnit : sc.uUnit, traces: [] };
      for (const s of SLOTS) {
        const idx = bay[set][s];
        if (idx === null) continue;
        const k = isI ? sc.i : sc.u;
        const inv = bay.invert.includes(idx) ? -1 : 1;
        const label = (isI ? { a: 'Ia', b: 'Ib', c: 'Ic', n: '3I0' } : { a: 'Ua', b: 'Ub', c: 'Uc', n: '3U0' })[s as PhaseSlot];
        panel.traces.push({ name: label, x: xs, y: rec.analog[idx].data.map((v) => v * k * inv), color: PHASE_COLORS[s] });
        if (state.showRms && bp) {
          const p = isI ? { a: bp.ia, b: bp.ib, c: bp.ic, n: bp.in }[s] : { a: bp.ua, b: bp.ub, c: bp.uc, n: bp.un }[s];
          panel.traces.push({ name: `|${label}| діюче`, x: xs, y: rmsTrace(p, k), color: PHASE_COLORS[s], dash: 'dot' });
        }
      }
      if (panel.traces.length) panels.push(panel);
    }
  }
  for (const idx of state.selectedAnalog) {
    if (bayIdx.has(idx)) continue;
    const ch = rec.analog[idx];
    const { k, unit } = channelScale(idx);
    panels.push({ title: ch.name, unit, traces: [{ name: ch.name, x: xs, y: ch.data.map((v) => v * k) }] });
  }

  const digIdx = state.selectedDigital.filter((i) => i < rec.digital.length);

  // Розкладка в пікселях: аналогові панелі однакової висоти, дискретні — 18 px на сигнал.
  const panelH = 210;
  const gapPx = 22;
  const digH = digIdx.length ? Math.max(80, digIdx.length * 18 + 20) : 0;
  const marginT = 28;
  const marginB = 50;
  const plotH = panels.length * (panelH + gapPx) + digH;
  const total = plotH + marginT + marginB;
  const layout: Partial<Plotly.Layout> = { ...baseLayout(), height: total, autosize: true, hovermode: 'x unified', showlegend: false, margin: { l: 70, r: 20, t: marginT, b: marginB } };
  const data: Plotly.Data[] = [];
  const annotations: Partial<Plotly.Annotation>[] = [];
  const nAxes = panels.length + (digIdx.length ? 1 : 0);
  const axName = (i: number) => (i === 0 ? 'y' : `y${i + 1}`);
  const axKey = (i: number) => (i === 0 ? 'yaxis' : `yaxis${i + 1}`);
  const L = layout as Record<string, unknown>;
  const gridColor = (baseLayout().yaxis as { gridcolor: string }).gridcolor;
  let y = plotH; // поточна верхня межа, px від низу області побудови
  panels.forEach((p, i) => {
    const domain: [number, number] = [(y - panelH) / plotH, y / plotH];
    L[axKey(i)] = { domain, title: { text: p.unit, standoff: 4 }, gridcolor: gridColor, zeroline: true, anchor: 'x' };
    annotations.push({ text: `<b>${p.title}</b>`, xref: 'paper', yref: 'paper', x: 0, y: domain[1], xanchor: 'left', yanchor: 'bottom', showarrow: false, font: { size: 12 } });
    for (const t of p.traces) {
      data.push({ type: 'scattergl', mode: 'lines', name: t.name, x: t.x, y: Array.from(t.y), xaxis: 'x', yaxis: axName(i), line: { width: 1.2, color: t.color, dash: t.dash as Plotly.Dash } } as Plotly.Data);
    }
    y -= panelH + gapPx;
  });
  if (digIdx.length) {
    const i = panels.length;
    const names = digIdx.map((d) => rec.digital[d].name);
    L[axKey(i)] = {
      domain: [0, Math.max(digH, 1) / plotH],
      tickvals: digIdx.map((_, k) => -k),
      ticktext: names.map((n) => (n.length > 34 ? n.slice(0, 33) + '…' : n)),
      range: [-digIdx.length + 0.1, 0.9],
      showgrid: false,
      zeroline: false,
      automargin: true,
      fixedrange: true,
      anchor: 'x',
    };
    digIdx.forEach((d, k) => {
      const ch = rec.digital[d];
      data.push({
        type: 'scattergl',
        mode: 'lines',
        name: ch.name,
        x: xs,
        y: Array.from(ch.data, (v) => -k + v * 0.7),
        xaxis: 'x',
        yaxis: axName(i),
        line: { width: 1.4, shape: 'hv', color: '#5b6773' },
        hovertemplate: `${ch.name}: %{customdata}<extra></extra>`,
        customdata: Array.from(ch.data),
      } as Plotly.Data);
    });
  }
  // Вісь часу — під нижньою панеллю; початковий масштаб — від передісторії до +400 мс.
  const pre = Math.min(rec.triggerTime * 1000, 200);
  layout.xaxis = {
    title: { text: 'Час відносно пуску, мс' },
    anchor: axName(Math.max(0, nAxes - 1)) as Plotly.AxisName,
    range: [-pre, Math.min(xs[xs.length - 1], 400)],
    gridcolor: (baseLayout().xaxis as { gridcolor: string }).gridcolor,
    showspikes: true,
    spikemode: 'across',
    spikethickness: 1,
  };
  layout.annotations = annotations;
  layout.shapes = cursorShapes();

  const controls = h(
    'div',
    { class: 'row' },
    checkbox('Діюче значення 1-ї гармоніки', state.showRms, (v) => {
      state.showRms = v;
      rerender();
    }),
    h('span', { class: 'muted' }, 'Клік — курсор А, Shift+клік — курсор В. Колесо миші — масштаб, подвійний клік — скидання.'),
  );

  const chooser = channelChooser(rerender);
  const plotDiv = h('div', { class: 'plot', style: `height:${total}px` });
  root.append(h('div', { class: 'osc' }, h('div', { class: 'osc-main' }, controls, plotDiv), chooser));
  if (!data.length) {
    plotDiv.append(h('p', { class: 'muted pad' }, 'Оберіть канали праворуч або призначте приєднання на вкладці «Дані».'));
    return;
  }
  Plotly.react(plotDiv, data, layout, plotConfig);
  const pd = plotDiv as unknown as Plotly.PlotlyHTMLElement;
  pd.on('plotly_click', (ev: Plotly.PlotMouseEvent) => {
    const pt = ev.points?.[0];
    if (!pt) return;
    const t = absFromMs(Number(pt.x));
    if ((ev.event as MouseEvent).shiftKey) state.tB = t;
    else state.tA = t;
    Plotly.relayout(plotDiv, { shapes: cursorShapes() });
    onCursor();
  });
}

export function cursorShapes(): Partial<Plotly.Shape>[] {
  const a = msRel(state.tA);
  const b = msRel(state.tB);
  return [
    { type: 'line', xref: 'x', yref: 'paper', x0: a, x1: a, y0: 0, y1: 1, line: { color: '#1f5fbf', width: 1.5 } },
    { type: 'line', xref: 'x', yref: 'paper', x0: b, x1: b, y0: 0, y1: 1, line: { color: '#8a5a00', width: 1.5, dash: 'dash' } },
  ];
}

function channelChooser(rerender: () => void): HTMLElement {
  const rec = state.grid!.rec;
  const filterInput = h('input', { type: 'search', placeholder: 'Пошук каналу…' });
  const listA = h('div', { class: 'chlist' });
  const listD = h('div', { class: 'chlist' });
  const changed = rec.digital.map((d) => d.data.some((v) => v !== d.data[0]));
  const fill = () => {
    const q = filterInput.value.toLowerCase();
    listA.replaceChildren(
      ...rec.analog
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !q || c.name.toLowerCase().includes(q))
        .map(({ c, i }) =>
          checkbox(c.name, state.selectedAnalog.includes(i), (on) => {
            state.selectedAnalog = on ? [...state.selectedAnalog, i] : state.selectedAnalog.filter((x) => x !== i);
            rerender();
          }),
        ),
    );
    listD.replaceChildren(
      ...rec.digital
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => (!state.onlyChangedDigital || changed[i]) && (!q || c.name.toLowerCase().includes(q)))
        .map(({ c, i }) =>
          checkbox(c.name, state.selectedDigital.includes(i), (on) => {
            state.selectedDigital = on ? [...state.selectedDigital, i] : state.selectedDigital.filter((x) => x !== i);
            rerender();
          }, { class: `check${changed[i] ? ' changed' : ''}` }),
        ),
    );
  };
  filterInput.addEventListener('input', fill);
  fill();
  return h(
    'aside',
    { class: 'osc-side card' },
    filterInput,
    h('h3', {}, 'Додаткові аналогові канали'),
    listA,
    h(
      'h3',
      {},
      'Дискретні',
      ' ',
      h('button', { class: 'link', onclick: () => {
        state.selectedDigital = rec.digital.map((_, i) => i).filter((i) => changed[i]);
        rerender();
      } }, 'усі змінені'),
      ' ',
      h('button', { class: 'link', onclick: () => {
        state.selectedDigital = [];
        rerender();
      } }, 'зняти'),
    ),
    checkbox('лише ті, що змінювали стан', state.onlyChangedDigital, (v) => {
      state.onlyChangedDigital = v;
      fill();
    }),
    listD,
  );
}
