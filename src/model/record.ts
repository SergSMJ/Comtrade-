/**
 * Уніфікована модель осцилограми. Усі джерела (COMTRADE, «Регіна») приводяться до неї.
 *
 * Аналогові значення зберігаються у ПЕРВИННИХ величинах базових одиниць СІ (В, А).
 * Перерахунок у вторинні: value · secondary / primary.
 */

export type AnalogKind = 'U' | 'I' | 'other';

export interface AnalogChannel {
  /** Порядковий номер у джерелі (з 1). */
  index: number;
  name: string;
  /** Поле ph з CFG або ідентифікатор з RgSet. */
  phase: string;
  /** Ідентифікатор кола/групи (ccbm у COMTRADE, група в RgSet). */
  circuit: string;
  /** Одиниця первинної величини після нормалізації: 'V', 'A' або вихідна. */
  unit: string;
  kind: AnalogKind;
  /** Первинні значення у В / А. */
  data: Float64Array;
  /** Номінал первинної обмотки ТС/ТН (1, якщо невідомо). */
  primary: number;
  /** Номінал вторинної обмотки ТС/ТН (1, якщо невідомо). */
  secondary: number;
}

export interface DigitalChannel {
  index: number;
  name: string;
  circuit: string;
  data: Uint8Array;
}

export interface RecordSource {
  format: 'COMTRADE' | 'Regina';
  /** Ревізія стандарту COMTRADE або опис джерела. */
  revision: string;
  files: string[];
  /** Додаткові відомості для звіту (HDR, RgSet). */
  notes: string[];
}

export interface Oscillogram {
  id: string;
  station: string;
  device: string;
  /** Номінальна частота мережі, Гц. */
  frequency: number;
  /** Час кожного відліку відносно першого відліку, с. */
  time: Float64Array;
  /** Момент пуску відносно першого відліку, с. */
  triggerTime: number;
  /** Абсолютний час першого відліку (текст з джерела). */
  startStamp: string;
  /** Абсолютний час пуску (текст з джерела). */
  triggerStamp: string;
  analog: AnalogChannel[];
  digital: DigitalChannel[];
  source: RecordSource;
  /** Еталонні значення з HDR термінала (для звірки), якщо є. */
  reference?: ReferenceData;
}

export interface ReferenceChannelValue {
  name: string;
  preRms?: number;
  preAngle?: number;
  faultRms?: number;
  faultAngle?: number;
}

export interface ReferenceData {
  device?: string;
  lineLength?: number;
  faultDistance?: number;
  faultLoop?: string;
  channels: ReferenceChannelValue[];
  events: { time: string; name: string; state: string }[];
}

export function samplingRate(rec: Oscillogram): number {
  const n = rec.time.length;
  if (n < 2) return 0;
  return (n - 1) / (rec.time[n - 1] - rec.time[0]);
}

/** Чи є крок дискретизації рівномірним (допуск 0,1 %). */
export function isUniform(time: Float64Array): boolean {
  const n = time.length;
  if (n < 3) return true;
  const dt = (time[n - 1] - time[0]) / (n - 1);
  for (let i = 1; i < n; i++) {
    if (Math.abs(time[i] - time[i - 1] - dt) > dt * 1e-3) return false;
  }
  return true;
}

/** Індекс відліку, найближчого до моменту t (с від першого відліку). */
export function sampleAt(rec: Oscillogram, t: number): number {
  const time = rec.time;
  let lo = 0;
  let hi = time.length - 1;
  if (t <= time[0]) return 0;
  if (t >= time[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  return t - time[lo] < time[hi] - t ? lo : hi;
}
