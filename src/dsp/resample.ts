import { isUniform, type Oscillogram } from '../model/record';

export interface AnalysisGrid {
  rec: Oscillogram;
  /** Відліків на період. */
  N: number;
  fs: number;
  resampled: boolean;
}

/**
 * Забезпечує рівномірну дискретизацію з цілим числом відліків на період.
 * Якщо умова не виконується — лінійна передискретизація (аналогові) та «утримання» (дискретні).
 */
export function toAnalysisGrid(rec: Oscillogram): AnalysisGrid {
  const n = rec.time.length;
  const f0 = rec.frequency || 50;
  const fs = (n - 1) / (rec.time[n - 1] - rec.time[0]);
  const spc = fs / f0;
  if (isUniform(rec.time) && Math.abs(spc - Math.round(spc)) < 1e-6 && Math.round(spc) >= 8) {
    return { rec, N: Math.round(spc), fs, resampled: false };
  }
  const N = Math.max(20, Math.round(spc / 4) * 4);
  const fs2 = N * f0;
  const t0 = rec.time[0];
  const m = Math.floor((rec.time[n - 1] - t0) * fs2) + 1;
  const time = new Float64Array(m);
  for (let i = 0; i < m; i++) time[i] = t0 + i / fs2;

  const pos = new Int32Array(m);
  const frac = new Float64Array(m);
  let j = 0;
  for (let i = 0; i < m; i++) {
    while (j < n - 2 && rec.time[j + 1] <= time[i]) j++;
    pos[i] = j;
    const dt = rec.time[j + 1] - rec.time[j];
    frac[i] = dt > 0 ? Math.min(1, Math.max(0, (time[i] - rec.time[j]) / dt)) : 0;
  }
  const analog = rec.analog.map((ch) => {
    const d = new Float64Array(m);
    for (let i = 0; i < m; i++) d[i] = ch.data[pos[i]] * (1 - frac[i]) + ch.data[pos[i] + 1] * frac[i];
    return { ...ch, data: d };
  });
  const digital = rec.digital.map((ch) => {
    const d = new Uint8Array(m);
    for (let i = 0; i < m; i++) d[i] = ch.data[frac[i] >= 1 ? pos[i] + 1 : pos[i]];
    return { ...ch, data: d };
  });
  const out: Oscillogram = {
    ...rec,
    time,
    analog,
    digital,
    source: {
      ...rec.source,
      notes: [...rec.source.notes, `Виконано передискретизацію ${fs.toFixed(1)} → ${fs2} Гц (${N} відліків на період) для обчислення векторів.`],
    },
  };
  return { rec: out, N, fs: fs2, resampled: true };
}
