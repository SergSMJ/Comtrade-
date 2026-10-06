/**
 * Обчислення векторів (лічильників) основної гармоніки.
 *
 * Вектор подається діючим значенням; кут відраховується від єдиної для всіх каналів
 * опорної косинусоїди cos(ω·t), t — час від першого відліку. Тому кути різних каналів
 * у той самий момент безпосередньо порівнювані, а для сталого режиму вектор нерухомий.
 * Вікно — каузальне: вектор у відліку k обчислено за відліками, що закінчуються на k
 * (як у терміналі РЗА).
 */
import type { C } from './complex';

export type FilterMethod = 'dft1' | 'dft05' | 'cosine' | 'mimic';

export interface FilterOptions {
  method: FilterMethod;
  /** Стала часу аперіодичної складової для mimic-фільтра, мс. */
  mimicTauMs?: number;
}

export interface PhasorSeries {
  re: Float64Array;
  im: Float64Array;
  /** Перший відлік з повністю заповненим вікном. */
  valid: number;
}

export const FILTER_LABELS: Record<FilterMethod, string> = {
  dft1: 'Фур’є, вікно 1 період',
  dft05: 'Фур’є, вікно ½ періоду',
  cosine: 'Косинусний фільтр',
  mimic: 'Mimic + Фур’є 1 період',
};

/** Затримка фільтра (від початку вікна до кінця), відліків. */
export function filterLatency(method: FilterMethod, N: number): number {
  switch (method) {
    case 'dft05':
      return Math.round(N / 2) - 1;
    case 'cosine':
      return N - 1 + N / 4;
    case 'mimic':
      return N;
    default:
      return N - 1;
  }
}

/**
 * @param x відліки (рівномірна дискретизація)
 * @param N кількість відліків на період основної частоти (ціле)
 * @param f0 основна частота, Гц
 */
export function computePhasors(x: Float64Array, N: number, opt: FilterOptions, f0 = 50): PhasorSeries {
  const n = x.length;
  const re = new Float64Array(n).fill(NaN);
  const im = new Float64Array(n).fill(NaN);
  const w = (2 * Math.PI) / N;
  const cosT = new Float64Array(N);
  const sinT = new Float64Array(N);
  for (let m = 0; m < N; m++) {
    cosT[m] = Math.cos(w * m);
    sinT[m] = Math.sin(w * m);
  }

  if (opt.method === 'dft1' || opt.method === 'dft05' || opt.method === 'mimic') {
    let src = x;
    let corr: C = { re: 1, im: 0 };
    if (opt.method === 'mimic') {
      const tau = ((opt.mimicTauMs ?? 40) / 1000) * N * f0; // τ у відліках (fs = N·f0)
      src = new Float64Array(n);
      for (let i = 1; i < n; i++) src[i] = (1 + tau) * x[i] - tau * x[i - 1];
      src[0] = src[1];
      // Передавальна функція на основній частоті: H = (1+τ) − τ·e^{−jω}; ділимо на H.
      const hr = 1 + tau - tau * Math.cos(w);
      const hi = tau * Math.sin(w);
      const d = hr * hr + hi * hi;
      corr = { re: hr / d, im: -hi / d };
    }
    const L = opt.method === 'dft05' ? Math.round(N / 2) : N;
    const k0 = opt.method === 'mimic' ? 1 : 0;
    const g = (2 * Math.SQRT2) / (2 * L);
    for (let k = L - 1 + k0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let i = k - L + 1; i <= k; i++) {
        const m = i % N;
        sr += src[i] * cosT[m];
        si -= src[i] * sinT[m];
      }
      sr *= g;
      si *= g;
      re[k] = sr * corr.re - si * corr.im;
      im[k] = sr * corr.im + si * corr.re;
    }
    return { re, im, valid: L - 1 + k0 };
  }

  // Косинусний фільтр: Cₖ = (2/N)·Σ x[k−N+1+m]·cos(2πm/N); уявна частина — Cₖ₋N/4.
  const C = new Float64Array(n).fill(NaN);
  for (let k = N - 1; k < n; k++) {
    let s = 0;
    for (let m = 0; m < N; m++) s += x[k - N + 1 + m] * cosT[m];
    C[k] = (2 / N) * s;
  }
  const q = N / 4;
  const qi = Math.floor(q);
  const qf = q - qi;
  const start = N - 1 + Math.ceil(q);
  for (let k = start; k < n; k++) {
    const a = C[k - qi];
    const b = qf > 0 ? C[k - qi - 1] : a;
    const s = a * (1 - qf) + b * qf;
    // Pₖ = (Cₖ + j·Sₖ)·e^{−jω(k−N+1)} / √2
    const phi = -w * ((k - N + 1) % N);
    const cr = Math.cos(phi);
    const ci = Math.sin(phi);
    re[k] = (C[k] * cr - s * ci) / Math.SQRT2;
    im[k] = (C[k] * ci + s * cr) / Math.SQRT2;
  }
  return { re, im, valid: start };
}

/** Діюче значення (повне, з усіма гармоніками) на ковзному вікні в один період. */
export function slidingRms(x: Float64Array, N: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += x[i] * x[i];
    if (i >= N) s -= x[i - N] * x[i - N];
    if (i >= N - 1) out[i] = Math.sqrt(Math.max(s, 0) / N);
  }
  return out;
}

export function phasorAt(p: PhasorSeries, k: number): C {
  return { re: p.re[k], im: p.im[k] };
}
