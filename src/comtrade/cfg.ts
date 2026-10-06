/**
 * Розбір файлу конфігурації COMTRADE (IEEE C37.111-1991/1999, IEC 60255-24:2013).
 */

export type DataFormat = 'ASCII' | 'BINARY' | 'BINARY32' | 'FLOAT32';

export interface CfgAnalog {
  index: number;
  id: string;
  phase: string;
  circuit: string;
  unit: string;
  a: number;
  b: number;
  skew: number;
  min: number;
  max: number;
  primary: number;
  secondary: number;
  ps: 'P' | 'S';
}

export interface CfgDigital {
  index: number;
  id: string;
  phase: string;
  circuit: string;
  normal: number;
}

export interface CfgRate {
  samp: number;
  endsamp: number;
}

export interface ComtradeCfg {
  station: string;
  device: string;
  revision: '1991' | '1999' | '2013';
  analog: CfgAnalog[];
  digital: CfgDigital[];
  frequency: number;
  rates: CfgRate[];
  start: string;
  trigger: string;
  startSeconds: number;
  triggerSeconds: number;
  format: DataFormat;
  timemult: number;
}

function num(s: string | undefined, def = 0): number {
  if (s === undefined) return def;
  const t = s.trim();
  if (t === '') return def;
  const v = Number(t);
  return Number.isFinite(v) ? v : def;
}

/**
 * Перетворює «дата,час» COMTRADE на секунди від 1970-01-01 (UTC без поясу).
 * 1991: mm/dd/yy; 1999/2013: dd/mm/yyyy.
 */
export function parseStamp(stamp: string, revision: string): number {
  const [datePart, timePart = '0:0:0'] = stamp.split(',').map((x) => x.trim());
  const d = datePart.split('/').map((x) => parseInt(x, 10));
  let day: number;
  let month: number;
  let year: number;
  if (revision === '1991') {
    [month, day, year] = d;
  } else {
    [day, month, year] = d;
  }
  if (!Number.isFinite(year)) return NaN;
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const [hh, mm, ss] = timePart.split(':');
  const base = Date.UTC(year, (month || 1) - 1, day || 1) / 1000;
  return base + num(hh) * 3600 + num(mm) * 60 + num(ss);
}

export function parseCfg(text: string): ComtradeCfg {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  let p = 0;
  const next = (): string[] => {
    while (p < lines.length && lines[p].trim() === '') p++;
    if (p >= lines.length) throw new Error('CFG: несподіваний кінець файлу (рядок ' + (p + 1) + ')');
    return lines[p++].split(',');
  };

  const l1 = next();
  const station = (l1[0] ?? '').trim();
  const device = (l1[1] ?? '').trim();
  const revRaw = (l1[2] ?? '').trim();
  const revision: ComtradeCfg['revision'] = revRaw === '' ? '1991' : revRaw.startsWith('2013') ? '2013' : revRaw.startsWith('1991') ? '1991' : '1999';

  const l2 = next();
  const total = num(l2[0]);
  const nA = num(l2[1]?.replace(/[aA]/, ''));
  const nD = num(l2[2]?.replace(/[dD]/, ''));
  if (nA + nD !== total) {
    // Деякі реєстратори заповнюють TT неправильно — довіряємо ##A та ##D.
  }

  const analog: CfgAnalog[] = [];
  for (let i = 0; i < nA; i++) {
    const f = next();
    const legacy = f.length < 13;
    analog.push({
      index: num(f[0], i + 1),
      id: (f[1] ?? '').trim(),
      phase: (f[2] ?? '').trim(),
      circuit: (f[3] ?? '').trim(),
      unit: (f[4] ?? '').trim(),
      a: num(f[5], 1),
      b: num(f[6], 0),
      skew: num(f[7], 0),
      min: num(f[8], -32767),
      max: num(f[9], 32767),
      primary: legacy ? 1 : num(f[10], 1) || 1,
      secondary: legacy ? 1 : num(f[11], 1) || 1,
      ps: !legacy && (f[12] ?? '').trim().toUpperCase() === 'S' ? 'S' : 'P',
    });
  }

  const digital: CfgDigital[] = [];
  for (let i = 0; i < nD; i++) {
    const f = next();
    if (f.length <= 3) {
      digital.push({ index: num(f[0], i + 1), id: (f[1] ?? '').trim(), phase: '', circuit: '', normal: num(f[2]) });
    } else {
      digital.push({
        index: num(f[0], i + 1),
        id: (f[1] ?? '').trim(),
        phase: (f[2] ?? '').trim(),
        circuit: (f[3] ?? '').trim(),
        normal: num(f[4]),
      });
    }
  }

  const frequency = num(next()[0], 50) || 50;
  const nrates = num(next()[0]);
  // При nrates = 0 стандарт усе одно містить рядок «0,endsamp» (тоді час — з міток DAT).
  const rates: CfgRate[] = [];
  for (let i = 0; i < Math.max(nrates, 1); i++) {
    const f = next();
    rates.push({ samp: nrates === 0 ? 0 : num(f[0]), endsamp: num(f[1]) });
  }

  const start = next().join(',').trim();
  const trigger = next().join(',').trim();
  const fmt = next()[0].trim().toUpperCase() as DataFormat;
  if (!['ASCII', 'BINARY', 'BINARY32', 'FLOAT32'].includes(fmt)) {
    throw new Error('CFG: невідомий формат даних «' + fmt + '»');
  }
  let timemult = 1;
  if (revision !== '1991' && p < lines.length) {
    const rest = lines.slice(p).find((l) => l.trim() !== '');
    if (rest !== undefined) timemult = num(rest.split(',')[0], 1) || 1;
  }

  return {
    station,
    device,
    revision,
    analog,
    digital,
    frequency,
    rates,
    start,
    trigger,
    startSeconds: parseStamp(start, revision),
    triggerSeconds: parseStamp(trigger, revision),
    format: fmt,
    timemult,
  };
}
