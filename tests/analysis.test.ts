import { describe, expect, it } from 'vitest';
import { synthRecord, toComtrade, type SynthFault } from './synthetic';
import { toAnalysisGrid } from '../src/dsp/resample';
import { autoDetectBays } from '../src/analysis/bay';
import { computeBayPhasors, compensationFromLine, loopInputs, loopImpedance, type LoopId } from '../src/analysis/compute';
import { abs, arg, deg, sub, wrapDeg, type C } from '../src/dsp/complex';
import type { FilterMethod } from '../src/dsp/phasor';
import { parseCfg } from '../src/comtrade/cfg';
import { buildComtradeRecord, loadComtradeFiles } from '../src/comtrade';
import { channelPhasors } from '../src/analysis/compute';
import { loadDir } from './helpers';

const Z1 = { re: 3, im: 28 }; // 100 км × (0,03 + j0,28) Ом/км
const Z0 = { re: 25, im: 95 };

function measure(f: SynthFault, loop: LoopId, method: FilterMethod, mode: 'k0' | 'rexe' = 'k0', viaComtrade?: 'ASCII' | 'BINARY') {
  let rec = synthRecord(f);
  if (viaComtrade) {
    const { cfg, dat } = toComtrade(rec, viaComtrade);
    rec = buildComtradeRecord(parseCfg(cfg), dat, 'synth', []);
  }
  const grid = toAnalysisGrid(rec);
  const bay = autoDetectBays(grid.rec)[0];
  const bp = computeBayPhasors(grid, bay, { method, mimicTauMs: f.dc?.tauMs });
  const comp = compensationFromLine(Z1.re, Z1.im, Z0.re, Z0.im);
  comp.mode = mode;
  // Момент: 150 мс після виникнення КЗ (сталий режим для всіх фільтрів).
  const k = Math.round((0.1 + 0.15) * grid.fs);
  return loopImpedance(loopInputs(bp, loop, k), comp);
}

function expectZ(z: C, ref: C) {
  expect(Math.abs(abs(z) / abs(ref) - 1)).toBeLessThan(0.01);
  expect(Math.abs(wrapDeg(deg(arg(z)) - deg(arg(ref))))).toBeLessThan(1);
}

describe('Петлі опору на синтетичних КЗ (критерій: |Z| ≤ 1 %, кут ≤ 1°)', () => {
  const half = { re: Z1.re / 2, im: Z1.im / 2 };
  const z0half = { re: Z0.re / 2, im: Z0.im / 2 };
  for (const method of ['dft1', 'dft05', 'cosine', 'mimic'] as FilterMethod[]) {
    it(`${method}: КЗ A-N на 50 % лінії`, () => {
      expectZ(measure({ type: 'AN', z1: half, z0: z0half, iFault: 8000, iAngle: -80 }, 'AN', method), half);
    });
    it(`${method}: КЗ B-C на 50 % лінії`, () => {
      expectZ(measure({ type: 'BC', z1: half, z0: z0half, iFault: 9000, iAngle: -95 }, 'BC', method), half);
    });
  }
  it('RE/RL, XE/XL (Siemens): КЗ C-N', () => {
    expectZ(measure({ type: 'CN', z1: half, z0: z0half, iFault: 7000, iAngle: 40 }, 'CN', 'dft1', 'rexe'), half);
  });
  it('трифазне КЗ, петля C-A', () => {
    expectZ(measure({ type: 'ABC', z1: half, z0: z0half, iFault: 10000, iAngle: -85 }, 'CA', 'dft1'), half);
  });
  it('mimic з аперіодичною складовою τ = 60 мс', () => {
    const f: SynthFault = { type: 'AN', z1: half, z0: z0half, iFault: 8000, iAngle: -80, dc: { ratio: 1, tauMs: 60 } };
    expectZ(measure(f, 'AN', 'mimic'), half);
  });
  it('через COMTRADE ASCII і BINARY (повний ланцюг парсер → вектор → опір)', () => {
    const f: SynthFault = { type: 'AN', z1: half, z0: z0half, iFault: 8000, iAngle: -80 };
    expectZ(measure(f, 'AN', 'dft1', 'k0', 'ASCII'), half);
    expectZ(measure(f, 'AN', 'dft1', 'k0', 'BINARY'), half);
  });
});

describe('Звірка з еталоном термінала ABB REL670 (HDR)', () => {
  const { records } = loadComtradeFiles(loadDir('rel670'));
  const rec = records[0];
  const grid = toAnalysisGrid(rec);
  const ref = rec.reference!;
  const vals = rec.analog.map((_, i) => channelPhasors(grid, i, { method: 'dft1' }));
  const kt = Math.round(rec.triggerTime * grid.fs);
  const used = rec.analog.map((ch, i) => ({ ch, i, r: ref.channels.find((c) => c.name === ch.name)! })).filter((x) => x.r.faultRms! > 50);
  // Момент обчислення HDR не задокументований: шукаємо відлік у межах 100 мс після пуску
  // з найменшою сумарною розбіжністю модулів і перевіряємо, що в ньому збігаються всі канали.
  let k = kt;
  let best = Infinity;
  for (let kk = kt; kk < kt + 100; kk++) {
    let e = 0;
    for (const { i, r } of used) e += (Math.hypot(vals[i].re[kk], vals[i].im[kk]) / r.faultRms! - 1) ** 2;
    if (e < best) [best, k] = [e, kk];
  }

  // Допуск 1,5 %: момент і фільтр HDR невідомі, а аварійний режим перехідний
  // (критерій 1 % концепції стосується сталого режиму синтетичних КЗ).
  it('аварійні діючі значення збігаються з HDR (≤ 1,5 %)', () => {
    for (const { ch, i, r } of used) {
      const v = Math.hypot(vals[i].re[k], vals[i].im[k]);
      expect(Math.abs(v / r.faultRms! - 1), ch.name).toBeLessThan(0.015);
    }
  });

  it('різниці кутів аварійного режиму збігаються з HDR (≤ 1°)', () => {
    const u = used.find((x) => x.ch.name === 'LINE VT A UL1')!;
    const a0 = Math.atan2(vals[u.i].im[k], vals[u.i].re[k]);
    for (const { ch, i, r } of used) {
      const a = Math.atan2(vals[i].im[k], vals[i].re[k]);
      const d = wrapDeg(deg(a - a0) - (r.faultAngle! - u.r.faultAngle!));
      expect(Math.abs(d), ch.name).toBeLessThan(1);
    }
  });

  it('автопідбір приєднань: LINE CT A ↔ LINE VT A', () => {
    const bays = autoDetectBays(rec);
    const line = bays.find((b) => b.name === 'LINE CT A')!;
    expect(rec.analog[line.u.a!].name).toBe('LINE VT A UL1');
    expect(rec.analog[line.i.n!].name).toBe('LINE CT A IN');
    expect(bays.map((b) => b.name).sort()).toEqual(['B20 CT A', 'B21 CT A', 'LINE CT A']);
  });

  it('виміряний IN відповідає сумі фаз', () => {
    const bays = autoDetectBays(rec);
    const line = bays.find((b) => b.name === 'LINE CT A')!;
    const bp = computeBayPhasors(grid, line, { method: 'dft1' });
    const kf = Math.round((rec.triggerTime + 0.03) * grid.fs);
    const sum = { re: bp.ia.re[kf] + bp.ib.re[kf] + bp.ic.re[kf], im: bp.ia.im[kf] + bp.ib.im[kf] + bp.ic.im[kf] };
    const meas = { re: bp.in.re[kf], im: bp.in.im[kf] };
    expect(abs(sub(sum, meas)) / abs(sum)).toBeLessThan(0.05);
  });
});
