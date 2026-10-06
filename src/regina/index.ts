/**
 * Формат реєстратора «Регіна»: ava*.dat (записи) + RgSet.dat (налаштування, cp866).
 *
 * Структура встановлена аналізом файлів ХАЕС ВРУ-750/330 (жовтень 2026):
 *  ava*.dat — сигнатура «REGINA#####»; блок часу [д][м][рік u16][год][хв][с][мс u16] = момент пуску;
 *    від нього +21 — № реєстратора, +22 — кількість дискретних подій,
 *    +24 — nch u16, N u16, evoff u32, doff u32;
 *    +36…evoff — початковий стан дискретів (біт = 0 → вхід активний);
 *    evoff — події по 8 байт: t (мс від пуску, u32), слово u16, маска змін u16;
 *    перед doff — nch номерів входів (u16); від doff — int16 блоками по каналу (N відліків).
 *  RgSet.dat — аналоговий дескриптор 0x6D байт: ім'я (40 байт), +0x46 вхід/група/реєстратор (u16),
 *    +0x5D — 4×float32 (a — калібрування зі знаком полярності, b — коефіцієнт трансформації,
 *    c — одиниць на відлік, d — діапазон). Первинне значення (кА, кВ) = raw · c · b · a.
 *    Дискретний запис: idx u16, реєстратор u16, u32, далі три рядки (u16 довжина + cp866):
 *    назва, панель, реле.
 */
import type { AnalogChannel, DigitalChannel, Oscillogram } from '../model/record';
import { baseName, decodeFixed, type InputFile } from '../io/text';

export interface ReginaAnalogDesc {
  offset: number;
  name: string;
  tag: string;
  input: number;
  group: number;
  recorder: number;
  a: number;
  b: number;
  c: number;
  d: number;
  /** 0x80 — струм, 0x82 — напруга (за спостереженнями). */
  typeCode: number;
}

export interface ReginaDigitalDesc {
  idx: number;
  recorder: number;
  name: string;
  panel: string;
  relay: string;
}

export interface ReginaSettings {
  object: string;
  analog: ReginaAnalogDesc[];
  digital: ReginaDigitalDesc[];
}

const CP866 = 'ibm866';
const DESC_SIZE = 0x6d;
/** Пре-історія запису за замовчуванням, мс. */
const DEFAULT_PRE_MS = 200;
const FS = 1000;

export function isReginaRecord(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 11)) === 'REGINA#####';
}

export function parseRgSet(bytes: Uint8Array): ReginaSettings {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const analog: ReginaAnalogDesc[] = [];
  // Пошук дескрипторів за сигнатурою на зміщенні 0x32: AA tt 00×8 tt.
  for (let p = 0x32; p + DESC_SIZE - 0x32 <= bytes.length; p++) {
    if (bytes[p] !== 0xaa) continue;
    const t = bytes[p + 1];
    if (t < 0x80 || t > 0x8f || bytes[p + 10] !== t) continue;
    let zeros = true;
    for (let k = 2; k < 10; k++) if (bytes[p + k] !== 0) zeros = false;
    if (!zeros) continue;
    const o = p - 0x32;
    if (o + DESC_SIZE > bytes.length) break;
    analog.push({
      offset: o,
      name: decodeFixed(bytes.subarray(o, o + 40), CP866).trim(),
      tag: decodeFixed(bytes.subarray(o + 40, o + 50), CP866).trim(),
      input: view.getUint16(o + 0x46, true),
      group: view.getUint16(o + 0x48, true),
      recorder: view.getUint16(o + 0x4a, true),
      a: view.getFloat32(o + 0x5d, true),
      b: view.getFloat32(o + 0x61, true),
      c: view.getFloat32(o + 0x65, true),
      d: view.getFloat32(o + 0x69, true),
      typeCode: t,
    });
    p += DESC_SIZE - 1;
  }

  const lastAnalog = analog.length ? analog[analog.length - 1].offset + DESC_SIZE : 0;
  const digital: ReginaDigitalDesc[] = [];
  const str = (p: number): [string, number] | null => {
    if (p + 2 > bytes.length) return null;
    const n = view.getUint16(p, true);
    if (n > 120 || p + 2 + n > bytes.length) return null;
    for (let k = 0; k < n; k++) if (bytes[p + 2 + k] < 0x20) return null;
    return [new TextDecoder(CP866).decode(bytes.subarray(p + 2, p + 2 + n)), p + 2 + n];
  };
  let p = lastAnalog;
  while (p + 12 < bytes.length) {
    const idx = view.getUint16(p, true);
    const rec = view.getUint16(p + 2, true);
    const flag = view.getUint32(p + 4, true);
    if (idx < 4096 && rec >= 1 && rec <= 16 && flag <= 1) {
      const s1 = str(p + 8);
      if (s1 && s1[0].length > 0) {
        const s2 = str(s1[1]);
        const s3 = s2 && str(s2[1]);
        if (s2 && s3) {
          digital.push({ idx, recorder: rec, name: s1[0].trim(), panel: s2[0].trim(), relay: s3[0].trim() });
          p = s3[1];
          continue;
        }
      }
    }
    p++;
  }

  // Назва об'єкта — перший рядок cp866 у заголовку (зміщення 0x14).
  const object = decodeFixed(bytes.subarray(0x14, 0x3c), CP866).trim();
  return { object, analog, digital };
}

interface AvaHeader {
  h: number;
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  recorder: number;
  nEvents: number;
  nch: number;
  n: number;
  evoff: number;
  doff: number;
}

function findHeader(bytes: Uint8Array): AvaHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let h = 11; h + 36 < bytes.length; h++) {
    const day = bytes[h];
    const month = bytes[h + 1];
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    const year = view.getUint16(h + 2, true);
    if (year < 1990 || year > 2100) continue;
    const hour = bytes[h + 4];
    const minute = bytes[h + 5];
    const second = bytes[h + 6];
    const ms = view.getUint16(h + 7, true);
    if (hour > 23 || minute > 59 || second > 59 || ms > 999) continue;
    const nch = view.getUint16(h + 24, true);
    const n = view.getUint16(h + 26, true);
    const evoff = view.getUint32(h + 28, true);
    const doff = view.getUint32(h + 32, true);
    if (nch === 0 || n === 0 || doff + nch * n * 2 !== bytes.length) continue;
    return { h, day, month, year, hour, minute, second, ms, recorder: bytes[h + 21], nEvents: view.getUint16(h + 22, true), nch, n, evoff, doff };
  }
  throw new Error('«Регіна»: не знайдено заголовок запису');
}

const pad = (v: number, n = 2) => String(v).padStart(n, '0');

function stamp(hd: AvaHeader, offsetMs: number): string {
  const base = Date.UTC(hd.year, hd.month - 1, hd.day, hd.hour, hd.minute, hd.second, hd.ms) + offsetMs;
  const d = new Date(base);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()},${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}000`;
}

export function parseAva(bytes: Uint8Array, settings: ReginaSettings, fileName: string, preMs = DEFAULT_PRE_MS): Oscillogram {
  if (!isReginaRecord(bytes)) throw new Error(`${fileName}: відсутня сигнатура REGINA`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hd = findHeader(bytes);
  const n = hd.n;

  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) time[i] = i / FS;

  const inputs: number[] = [];
  for (let k = 0; k < hd.nch; k++) inputs.push(view.getUint16(hd.doff - 2 * hd.nch + 2 * k, true));

  const analog: AnalogChannel[] = [];
  inputs.forEach((inp, k) => {
    const desc = settings.analog.find((d) => d.recorder === hd.recorder && d.input === inp);
    const raw = new Int16Array(n);
    for (let i = 0; i < n; i++) raw[i] = view.getInt16(hd.doff + 2 * (k * n + i), true);
    const isU = desc?.typeCode === 0x82;
    const isI = desc?.typeCode === 0x80;
    const gain = desc ? desc.a * desc.b * desc.c * 1000 : 1;
    const data = new Float64Array(n);
    for (let i = 0; i < n; i++) data[i] = raw[i] * gain;
    const secondary = isU ? 100 : 1;
    const ratio = desc && desc.b > 0 ? desc.b * 1000 : 1;
    analog.push({
      index: inp,
      name: desc?.name || `Вхід ${inp}`,
      phase: desc?.tag ?? '',
      circuit: desc ? `G${desc.group}` : '',
      unit: isU ? 'V' : isI ? 'A' : 'о.в.',
      kind: isU ? 'U' : isI ? 'I' : 'other',
      data,
      primary: ratio * secondary,
      secondary,
    });
  });

  // Дискретні сигнали: початковий стан + перемикання за подіями.
  const initBytes = bytes.subarray(hd.h + 36, hd.evoff);
  const nBits = initBytes.length * 8;
  const events: { t: number; word: number; mask: number }[] = [];
  for (let k = 0; k < hd.nEvents; k++) {
    const o = hd.evoff + 8 * k;
    if (o + 8 > hd.doff) break;
    events.push({ t: view.getUint32(o, true), word: view.getUint16(o + 4, true), mask: view.getUint16(o + 6, true) });
  }
  events.sort((x, y) => x.t - y.t);

  const descs = settings.digital.filter((d) => d.recorder === hd.recorder && d.idx < nBits);
  const byIdx = new Map(descs.map((d) => [d.idx, d]));
  const usedBits = new Set<number>(descs.map((d) => d.idx));
  for (const e of events) for (let b = 0; b < 16; b++) if (e.mask & (1 << b)) usedBits.add(e.word * 16 + b);

  const digital: DigitalChannel[] = [];
  for (const bit of [...usedBits].sort((x, y) => x - y)) {
    if (bit >= nBits) continue;
    const initActive = ((initBytes[bit >> 3] >> (bit & 7)) & 1) === 0 ? 1 : 0;
    const data = new Uint8Array(n);
    let state = initActive;
    let ei = 0;
    const toggles = events.filter((e) => e.word === bit >> 4 && e.mask & (1 << (bit & 15)));
    for (let i = 0; i < n; i++) {
      const tMs = i - preMs;
      while (ei < toggles.length && toggles[ei].t <= tMs) {
        state ^= 1;
        ei++;
      }
      data[i] = state;
    }
    const d = byIdx.get(bit);
    const label = d ? [d.name, d.panel && `пан. ${d.panel}`, d.relay].filter(Boolean).join(' · ') : `Вхід ${bit} (без підпису)`;
    digital.push({ index: bit, name: label, circuit: '', data });
  }
  // Сигнали, що змінювали стан, — першими (решта лише фіксують початковий стан).
  const changed = new Set<number>();
  for (const e of events) for (let b = 0; b < 16; b++) if (e.mask & (1 << b)) changed.add(e.word * 16 + b);
  digital.sort((x, y) => Number(changed.has(y.index)) - Number(changed.has(x.index)) || x.index - y.index);

  return {
    id: `${baseName(fileName)} · Р${hd.recorder}`,
    station: settings.object,
    device: `«Регіна», реєстратор ${hd.recorder}`,
    frequency: 50,
    time,
    triggerTime: preMs / FS,
    startStamp: stamp(hd, -preMs),
    triggerStamp: stamp(hd, 0),
    analog,
    digital,
    source: {
      format: 'Regina',
      revision: 'ava/RgSet',
      files: [fileName],
      notes: [
        'Підписи дискретних входів RgSet не є доказом фактичного заведення сигналу — ідентифікуйте канал за часом і фізикою процесу.',
        'Полярність каналів визначається знаком калібрувального коефіцієнта RgSet.',
      ],
    },
  };
}

export function loadReginaFiles(files: InputFile[]): { records: Oscillogram[]; errors: string[] } {
  const records: Oscillogram[] = [];
  const errors: string[] = [];
  const setFile = files.find((f) => baseName(f.name).toLowerCase() === 'rgset.dat');
  const avas = files.filter((f) => isReginaRecord(f.bytes));
  if (!avas.length) return { records, errors };
  if (!setFile) {
    errors.push('«Регіна»: для розшифрування ava*.dat потрібен файл RgSet.dat');
    return { records, errors };
  }
  const settings = parseRgSet(setFile.bytes);
  for (const f of avas.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const rec = parseAva(f.bytes, settings, f.name);
      rec.source.files.push(setFile.name);
      records.push(rec);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { records, errors };
}
