/**
 * Генератор синтетичних осцилограм із відомими параметрами КЗ.
 * Модель: напруга в місці установки захисту U = Z1·d·Iф + (Z0−Z1)/3·d·3I0 + Rf·If (для ф-з).
 */
import type { Oscillogram } from '../src/model/record';
import type { C } from '../src/dsp/complex';

export interface SynthFault {
  type: 'AN' | 'BN' | 'CN' | 'AB' | 'BC' | 'CA' | 'ABC';
  /** Z1 до місця КЗ (первинні Ом). */
  z1: C;
  /** Z0 до місця КЗ. */
  z0: C;
  /** Струм КЗ, А (діюче), кут, °. */
  iFault: number;
  iAngle: number;
  /** Перехідний опір (лише для ф-з, однобічне живлення), Ом. */
  rf?: number;
  /** Аперіодична складова: частка амплітуди та стала часу, мс. */
  dc?: { ratio: number; tauMs: number };
}

const rad = (d: number) => (d * Math.PI) / 180;
const pol = (m: number, a: number): C => ({ re: m * Math.cos(rad(a)), im: m * Math.sin(rad(a)) });
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const sc = (a: C, k: number): C => ({ re: a.re * k, im: a.im * k });

export function synthRecord(f: SynthFault, fs = 1000, f0 = 50, preS = 0.1, faultS = 0.2): Oscillogram {
  const n = Math.round((preS + faultS) * fs);
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) time[i] = i / fs;
  const Un = 750e3 / Math.sqrt(3);
  const Iload = 500;
  const pre = {
    ua: pol(Un, 0),
    ub: pol(Un, -120),
    uc: pol(Un, 120),
    ia: pol(Iload, -20),
    ib: pol(Iload, -140),
    ic: pol(Iload, 100),
  };
  // Аварійний режим: струми пошкоджених фаз = If, непошкоджених — навантаження.
  const If = pol(f.iFault, f.iAngle);
  const fl = { ...pre };
  const zm = sc(add(f.z0, sc(f.z1, -1)), 1 / 3);
  const healthy = (u: C) => sc(u, 0.98);
  fl.ua = healthy(pre.ua);
  fl.ub = healthy(pre.ub);
  fl.uc = healthy(pre.uc);
  switch (f.type) {
    case 'AN':
    case 'BN':
    case 'CN': {
      const ph = f.type[0].toLowerCase() as 'a' | 'b' | 'c';
      const key = ('i' + ph) as 'ia' | 'ib' | 'ic';
      fl[key] = If;
      const In = add(add(fl.ia, fl.ib), fl.ic);
      const u = add(add(mul(f.z1, fl[key]), mul(zm, In)), sc(If, f.rf ?? 0));
      fl[('u' + ph) as 'ua' | 'ub' | 'uc'] = u;
      break;
    }
    case 'AB':
    case 'BC':
    case 'CA':
    case 'ABC': {
      const p1 = f.type === 'ABC' ? 'a' : (f.type[0].toLowerCase() as 'a' | 'b' | 'c');
      const p2 = f.type === 'ABC' ? 'b' : (f.type[1].toLowerCase() as 'a' | 'b' | 'c');
      const rot = { a: 0, b: -120, c: 120 };
      if (f.type === 'ABC') {
        for (const p of ['a', 'b', 'c'] as const) {
          const i = pol(f.iFault, f.iAngle + rot[p]);
          fl[('i' + p) as 'ia'] = i;
          fl[('u' + p) as 'ua'] = mul(f.z1, i);
        }
      } else {
        fl[('i' + p1) as 'ia'] = If;
        fl[('i' + p2) as 'ia'] = sc(If, -1);
        // Середня точка: U1 = Um + Z1·If, U2 = Um − Z1·If.
        const third = (['a', 'b', 'c'] as const).find((p) => p !== p1 && p !== p2)!;
        const um = sc(fl[('u' + third) as 'ua'], -0.5);
        fl[('u' + p1) as 'ua'] = add(um, mul(f.z1, If));
        fl[('u' + p2) as 'ua'] = add(um, sc(mul(f.z1, If), -1));
      }
      break;
    }
  }
  const w = 2 * Math.PI * f0;
  const wave = (k: 'ua' | 'ub' | 'uc' | 'ia' | 'ib' | 'ic') => {
    const d = new Float64Array(n);
    const nPre = Math.round(preS * fs);
    for (let i = 0; i < n; i++) {
      const ph = i < nPre ? pre[k] : fl[k];
      const t = time[i];
      d[i] = Math.SQRT2 * (ph.re * Math.cos(w * t) - ph.im * Math.sin(w * t));
      if (i >= nPre && f.dc && k.startsWith('i') && fl[k] !== pre[k]) {
        const t0 = time[nPre];
        // Аперіодична складова, що компенсує стрибок миттєвого значення.
        const amp = -f.dc.ratio * Math.SQRT2 * (ph.re * Math.cos(w * t0) - ph.im * Math.sin(w * t0));
        d[i] += amp * Math.exp(-(t - t0) / (f.dc.tauMs / 1000));
      }
    }
    return d;
  };
  const ch = (name: string, kind: 'U' | 'I', key: 'ua' | 'ub' | 'uc' | 'ia' | 'ib' | 'ic', index: number) => ({
    index,
    name,
    phase: '',
    circuit: '',
    unit: kind === 'U' ? 'V' : 'A',
    kind,
    data: wave(key),
    primary: kind === 'U' ? 750000 : 2000,
    secondary: kind === 'U' ? 100 : 1,
  });
  return {
    id: 'synth',
    station: 'TEST',
    device: 'SYNTH',
    frequency: f0,
    time,
    triggerTime: preS,
    startStamp: '',
    triggerStamp: '',
    analog: [ch('IL1', 'I', 'ia', 1), ch('IL2', 'I', 'ib', 2), ch('IL3', 'I', 'ic', 3), ch('UL1', 'U', 'ua', 4), ch('UL2', 'U', 'ub', 5), ch('UL3', 'U', 'uc', 6)],
    digital: [],
    source: { format: 'COMTRADE', revision: 'synthetic', files: [], notes: [] },
  };
}

/** Запис синтетичної осцилограми у COMTRADE 1999 (CFG + DAT). */
export function toComtrade(rec: Oscillogram, format: 'ASCII' | 'BINARY'): { cfg: string; dat: Uint8Array } {
  const n = rec.time.length;
  const fs = Math.round((n - 1) / (rec.time[n - 1] - rec.time[0]));
  const scales = rec.analog.map((c) => {
    let m = 0;
    for (const v of c.data) m = Math.max(m, Math.abs(v));
    return (m || 1) / 32000;
  });
  const lines = [
    `${rec.station},${rec.device},1999`,
    `${rec.analog.length},${rec.analog.length}A,0D`,
    ...rec.analog.map((c, k) => `${k + 1},${c.name},,,${c.unit},${scales[k]},0,0,-32767,32767,${c.primary},${c.secondary},P`),
    `${rec.frequency}`,
    '1',
    `${fs},${n}`,
    '01/01/2026,00:00:00.000000',
    `01/01/2026,00:00:00.${String(Math.round(rec.triggerTime * 1e6)).padStart(6, '0')}`,
    format,
    '1',
  ];
  if (format === 'ASCII') {
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      rows.push([i + 1, Math.round(rec.time[i] * 1e6), ...rec.analog.map((c, k) => Math.round(c.data[i] / scales[k]))].join(','));
    }
    return { cfg: lines.join('\r\n'), dat: new TextEncoder().encode(rows.join('\r\n')) };
  }
  const rs = 8 + 2 * rec.analog.length;
  const buf = new DataView(new ArrayBuffer(rs * n));
  for (let i = 0; i < n; i++) {
    buf.setUint32(i * rs, i + 1, true);
    buf.setUint32(i * rs + 4, Math.round(rec.time[i] * 1e6), true);
    rec.analog.forEach((c, k) => buf.setInt16(i * rs + 8 + 2 * k, Math.round(c.data[i] / scales[k]), true));
  }
  return { cfg: lines.join('\r\n'), dat: new Uint8Array(buf.buffer) };
}
