/**
 * Вектори приєднання, симетричні складові, петлі опору.
 */
import { A, A2, add, div, mul, scale, sub, type C } from '../dsp/complex';
import { computePhasors, type FilterOptions, type PhasorSeries } from '../dsp/phasor';
import type { AnalysisGrid } from '../dsp/resample';
import type { BayMap, PhaseSlot } from './bay';

export interface BayPhasors {
  ia: PhasorSeries;
  ib: PhasorSeries;
  ic: PhasorSeries;
  /** 3I0: виміряний (якщо призначено) або сума фаз. */
  in: PhasorSeries;
  inMeasured: boolean;
  ua: PhasorSeries;
  ub: PhasorSeries;
  uc: PhasorSeries;
  /** 3U0: виміряна (якщо призначено) або сума фаз. */
  un: PhasorSeries;
  unMeasured: boolean;
  /** 3I0 паралельної лінії (для компенсації взаємоіндукції). */
  inParallel?: PhasorSeries;
  valid: number;
  hasI: boolean;
  hasU: boolean;
}

function zeros(n: number): PhasorSeries {
  return { re: new Float64Array(n), im: new Float64Array(n), valid: 0 };
}

function sum3(a: PhasorSeries, b: PhasorSeries, c: PhasorSeries): PhasorSeries {
  const n = a.re.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    re[k] = a.re[k] + b.re[k] + c.re[k];
    im[k] = a.im[k] + b.im[k] + c.im[k];
  }
  return { re, im, valid: Math.max(a.valid, b.valid, c.valid) };
}

export function channelPhasors(grid: AnalysisGrid, idx: number, filter: FilterOptions, invert = false): PhasorSeries {
  const ch = grid.rec.analog[idx];
  let x = ch.data;
  if (invert) x = x.map((v) => -v);
  return computePhasors(x, grid.N, filter, grid.rec.frequency || 50);
}

export function computeBayPhasors(grid: AnalysisGrid, bay: BayMap, filter: FilterOptions, parallelIn: number | null = null): BayPhasors {
  const n = grid.rec.time.length;
  const get = (set: Record<PhaseSlot, number | null>, s: PhaseSlot) => {
    const idx = set[s];
    return idx === null ? null : channelPhasors(grid, idx, filter, bay.invert.includes(idx));
  };
  const ia = get(bay.i, 'a');
  const ib = get(bay.i, 'b');
  const ic = get(bay.i, 'c');
  const ua = get(bay.u, 'a');
  const ub = get(bay.u, 'b');
  const uc = get(bay.u, 'c');
  const hasI = !!(ia && ib && ic);
  const hasU = !!(ua && ub && uc);
  const Ia = ia ?? zeros(n);
  const Ib = ib ?? zeros(n);
  const Ic = ic ?? zeros(n);
  const Ua = ua ?? zeros(n);
  const Ub = ub ?? zeros(n);
  const Uc = uc ?? zeros(n);
  const inM = get(bay.i, 'n');
  const unM = get(bay.u, 'n');
  const res: BayPhasors = {
    ia: Ia,
    ib: Ib,
    ic: Ic,
    in: inM ?? sum3(Ia, Ib, Ic),
    inMeasured: !!inM,
    ua: Ua,
    ub: Ub,
    uc: Uc,
    un: unM ?? sum3(Ua, Ub, Uc),
    unMeasured: !!unM,
    valid: Math.max(Ia.valid, Ib.valid, Ic.valid, Ua.valid, Ub.valid, Uc.valid),
    hasI,
    hasU,
  };
  if (parallelIn !== null) res.inParallel = channelPhasors(grid, parallelIn, filter, bay.invert.includes(parallelIn));
  return res;
}

export const at = (p: PhasorSeries, k: number): C => ({ re: p.re[k], im: p.im[k] });

export interface Sequence {
  x0: C;
  x1: C;
  x2: C;
}

/** Симетричні складові (X0 — складова нульової послідовності, не 3X0). */
export function sequence(a: C, b: C, c: C): Sequence {
  return {
    x0: scale(add(add(a, b), c), 1 / 3),
    x1: scale(add(add(a, mul(A, b)), mul(A2, c)), 1 / 3),
    x2: scale(add(add(a, mul(A2, b)), mul(A, c)), 1 / 3),
  };
}

/* ---------------------------- Петлі опору ---------------------------- */

export type LoopId = 'AB' | 'BC' | 'CA' | 'AN' | 'BN' | 'CN';
export const LOOPS: LoopId[] = ['AB', 'BC', 'CA', 'AN', 'BN', 'CN'];
export const PP_LOOPS: LoopId[] = ['AB', 'BC', 'CA'];
export const PE_LOOPS: LoopId[] = ['AN', 'BN', 'CN'];

export interface Compensation {
  /** 'k0' — комплексний k0 = (Z0−Z1)/(3·Z1); 'rexe' — RE/RL, XE/XL окремо (Siemens). */
  mode: 'k0' | 'rexe';
  k0: C;
  rerl: number;
  xexl: number;
  /** Взаємоіндукція паралельної лінії: k0m = Z0m/(3·Z1) (або RM/RL, XM/XL). */
  useMutual: boolean;
  k0m: C;
  rmrl: number;
  xmxl: number;
}

export function compensationFromLine(r1: number, x1: number, r0: number, x0: number, r0m = 0, x0m = 0): Compensation {
  const z1: C = { re: r1, im: x1 };
  const k0 = div(sub({ re: r0, im: x0 }, z1), scale(z1, 3));
  const k0m = div({ re: r0m, im: x0m }, scale(z1, 3));
  return {
    mode: 'k0',
    k0,
    rerl: r1 ? (r0 / r1 - 1) / 3 : 0,
    xexl: x1 ? (x0 / x1 - 1) / 3 : 0,
    useMutual: false,
    k0m,
    rmrl: r1 ? r0m / (3 * r1) : 0,
    xmxl: x1 ? x0m / (3 * x1) : 0,
  };
}

export interface LoopInputs {
  u: C;
  i: C;
  /** Для петель фаза-земля: 3I0 власної та паралельної лінії. */
  in?: C;
  inp?: C;
}

export function loopInputs(bp: BayPhasors, loop: LoopId, k: number): LoopInputs {
  const Ua = at(bp.ua, k);
  const Ub = at(bp.ub, k);
  const Uc = at(bp.uc, k);
  const Ia = at(bp.ia, k);
  const Ib = at(bp.ib, k);
  const Ic = at(bp.ic, k);
  const In = at(bp.in, k);
  const Inp = bp.inParallel ? at(bp.inParallel, k) : undefined;
  switch (loop) {
    case 'AB':
      return { u: sub(Ua, Ub), i: sub(Ia, Ib) };
    case 'BC':
      return { u: sub(Ub, Uc), i: sub(Ib, Ic) };
    case 'CA':
      return { u: sub(Uc, Ua), i: sub(Ic, Ia) };
    case 'AN':
      return { u: Ua, i: Ia, in: In, inp: Inp };
    case 'BN':
      return { u: Ub, i: Ib, in: In, inp: Inp };
    case 'CN':
      return { u: Uc, i: Ic, in: In, inp: Inp };
  }
}

/** Опір петлі в первинних Ом (у площині прямої послідовності для петель фаза-земля). */
export function loopImpedance(inp: LoopInputs, comp: Compensation): C {
  if (inp.in === undefined) return div(inp.u, inp.i);
  const inp2 = comp.useMutual && inp.inp ? inp.inp : undefined;
  if (comp.mode === 'k0') {
    let iComp = add(inp.i, mul(comp.k0, inp.in));
    if (inp2) iComp = add(iComp, mul(comp.k0m, inp2));
    return div(inp.u, iComp);
  }
  // U = R·(I + kr·IN + krm·INp) + X·j·(I + kx·IN + kxm·INp) — дві дійсні невідомі R, X.
  let a = add(inp.i, scale(inp.in, comp.rerl));
  let bi = add(inp.i, scale(inp.in, comp.xexl));
  if (inp2) {
    a = add(a, scale(inp2, comp.rmrl));
    bi = add(bi, scale(inp2, comp.xmxl));
  }
  const b: C = { re: -bi.im, im: bi.re };
  const imU_Bc = inp.u.im * b.re - inp.u.re * b.im;
  const imA_Bc = a.im * b.re - a.re * b.im;
  const imU_Ac = inp.u.im * a.re - inp.u.re * a.im;
  const imB_Ac = b.im * a.re - b.re * a.im;
  return { re: imU_Bc / imA_Bc, im: imU_Ac / imB_Ac };
}

export interface ImpedanceTrace {
  loop: LoopId;
  t: number[];
  r: number[];
  x: number[];
  k: number[];
}

/**
 * Траєкторія опору петлі на інтервалі [k1; k2].
 * @param iMin мінімальний струм петлі (первинний, А), нижче якого опір не обчислюється
 * @param zScale множник переходу до відображуваних одиниць (1 — первинні, Kтс/Kтн — вторинні)
 */
export function impedanceTrace(
  bp: BayPhasors,
  loop: LoopId,
  comp: Compensation,
  time: Float64Array,
  k1: number,
  k2: number,
  iMin: number,
  zScale: number,
  step = 1,
): ImpedanceTrace {
  const tr: ImpedanceTrace = { loop, t: [], r: [], x: [], k: [] };
  const start = Math.max(k1, bp.valid);
  for (let k = start; k <= k2; k += step) {
    const li = loopInputs(bp, loop, k);
    const iMag = Math.hypot(li.i.re, li.i.im);
    if (!(iMag >= iMin)) continue;
    const z = loopImpedance(li, comp);
    if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) continue;
    tr.t.push(time[k]);
    tr.r.push(z.re * zScale);
    tr.x.push(z.im * zScale);
    tr.k.push(k);
  }
  return tr;
}
