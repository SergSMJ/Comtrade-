export interface C {
  re: number;
  im: number;
}

export const c = (re: number, im = 0): C => ({ re, im });
export const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a: C, k: number): C => ({ re: a.re * k, im: a.im * k });
export const conj = (a: C): C => ({ re: a.re, im: -a.im });
export const abs = (a: C): number => Math.hypot(a.re, a.im);
export const arg = (a: C): number => Math.atan2(a.im, a.re);
export const neg = (a: C): C => ({ re: -a.re, im: -a.im });

export function div(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: NaN, im: NaN };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export const polar = (mag: number, angleRad: number): C => ({ re: mag * Math.cos(angleRad), im: mag * Math.sin(angleRad) });
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Кут у діапазоні (−180°; 180°]. */
export function wrapDeg(d: number): number {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/** Оператор повороту a = e^{j120°}. */
export const A = polar(1, (2 * Math.PI) / 3);
export const A2 = polar(1, (-2 * Math.PI) / 3);
