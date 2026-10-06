import type { AnalogKind } from './record';

const LAT = { а: 'a', в: 'b', с: 'c', е: 'e', і: 'i', о: 'o', к: 'k', м: 'm', А: 'A', В: 'B', С: 'C', Е: 'E', І: 'I', О: 'O', К: 'K', М: 'M' } as Record<string, string>;

/** Заміна схожих кириличних літер латинськими (для розпізнавання назв). */
export function latinize(s: string): string {
  return s.replace(/[авсеіокмАВСЕІОКМ]/g, (ch) => LAT[ch] ?? ch);
}

export interface UnitInfo {
  kind: AnalogKind;
  /** Множник до базової одиниці (В або А). */
  factor: number;
  base: string;
}

/** Аналіз одиниці виміру: V, kV, A, kA, mA, «кВ», «кА» тощо. */
export function unitInfo(unit: string): UnitInfo {
  const u = latinize(unit.trim());
  const m = /^(m|k|M)?\s*(V|A)$/i.exec(u.replace(/^K/, 'k'));
  if (!m) {
    if (/^b$/i.test(u)) return { kind: 'U', factor: 1, base: 'V' }; // кириличне «В»
    if (/^kb$/i.test(u)) return { kind: 'U', factor: 1000, base: 'V' };
    return { kind: 'other', factor: 1, base: unit };
  }
  const prefix = m[1] ?? '';
  const kind: AnalogKind = m[2].toUpperCase() === 'V' ? 'U' : 'I';
  const factor = prefix === 'k' || prefix === 'K' ? 1e3 : prefix === 'M' ? 1e6 : prefix === 'm' ? 1e-3 : 1;
  return { kind, factor, base: kind === 'U' ? 'V' : 'A' };
}

/** Число з фіксованою кількістю значущих цифр, без експоненційного запису. */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const decimals = Math.max(0, Math.min(6, digits - 1 - mag));
  return v.toFixed(decimals);
}

/** Значення з автоматичним префіксом «к» для В/А. */
export function formatValue(v: number, unit: string, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  if (unit === 'V' || unit === 'A') {
    const ua = unit === 'V' ? 'В' : 'А';
    if (Math.abs(v) >= 1e3) return fmt(v / 1e3, digits) + ' к' + ua;
    return fmt(v, digits) + ' ' + ua;
  }
  return fmt(v, digits) + ' ' + unit;
}
