import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InputFile } from '../src/io/text';

export const SAMPLES = join(__dirname, '..', 'samples');

export function loadDir(dir: string): InputFile[] {
  const full = join(SAMPLES, dir);
  return readdirSync(full).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(full, name))) }));
}

export function rms(x: Float64Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}
