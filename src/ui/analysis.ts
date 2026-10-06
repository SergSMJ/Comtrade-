/** Обчислення з кешуванням для поточного стану інтерфейсу. */
import { computeBayPhasors, type BayPhasors } from '../analysis/compute';
import { bayRatios } from '../analysis/bay';
import { sampleAt } from '../model/record';
import { currentBay, currentSettings, state } from './state';

let cacheKey = '';
let cache: BayPhasors | null = null;

export function bayPhasors(): BayPhasors | null {
  const grid = state.grid;
  const bay = currentBay();
  if (!grid || !bay) return null;
  const s = currentSettings();
  const key = JSON.stringify([grid.rec.id, bay, state.filter, s.line.useMutual ? s.line.parallelIn : null]);
  if (key !== cacheKey) {
    cache = computeBayPhasors(grid, bay, state.filter, s.line.useMutual ? s.line.parallelIn : null);
    cacheKey = key;
  }
  return cache;
}

export function invalidate(): void {
  cacheKey = '';
}

/** Перехід первинне → відображуване для U, I, Z. */
export function displayScale(): { u: number; i: number; z: number; uUnit: string; iUnit: string; zUnit: string } {
  const grid = state.grid;
  const bay = currentBay();
  const r = grid && bay ? bayRatios(grid.rec, bay) : { ct: 1, vt: 1 };
  if (state.units === 'sec') {
    return { u: 1 / r.vt, i: 1 / r.ct, z: r.ct / r.vt, uUnit: 'В', iUnit: 'А', zUnit: 'Ом втор.' };
  }
  return { u: 1e-3, i: 1e-3, z: 1, uUnit: 'кВ', iUnit: 'кА', zUnit: 'Ом перв.' };
}

/** Множник переходу для каналу довільного типу (не з приєднання). */
export function channelScale(idx: number): { k: number; unit: string } {
  const ch = state.grid?.rec.analog[idx];
  if (!ch) return { k: 1, unit: '' };
  if (ch.kind === 'other') return { k: 1, unit: ch.unit };
  const sec = state.units === 'sec';
  const ratio = ch.primary / ch.secondary;
  if (ch.kind === 'U') return sec ? { k: 1 / ratio, unit: 'В' } : { k: 1e-3, unit: 'кВ' };
  return sec ? { k: 1 / ratio, unit: 'А' } : { k: 1e-3, unit: 'кА' };
}

export const kA = (): number => (state.grid ? sampleAt(state.grid.rec, state.tA) : 0);
export const kB = (): number => (state.grid ? sampleAt(state.grid.rec, state.tB) : 0);

/** Час, мс відносно пуску. */
export const msRel = (t: number): number => (t - (state.grid?.rec.triggerTime ?? 0)) * 1000;
export const absFromMs = (ms: number): number => (state.grid?.rec.triggerTime ?? 0) + ms / 1000;

export const PHASE_COLORS = { a: '#c99a00', b: '#2e8b3a', c: '#d0312d', n: '#3b6fd1' } as const;
export const LOOP_COLORS: Record<string, string> = {
  AB: '#b5651d',
  BC: '#7b3fa0',
  CA: '#0f8a8a',
  AN: PHASE_COLORS.a,
  BN: PHASE_COLORS.b,
  CN: PHASE_COLORS.c,
};
