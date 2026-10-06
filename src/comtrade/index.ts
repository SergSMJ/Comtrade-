import { parseCfg, type ComtradeCfg } from './cfg';
import { parseDat } from './dat';
import { parseAbbHdr } from './hdr';
import type { AnalogChannel, DigitalChannel, Oscillogram } from '../model/record';
import { unitInfo, latinize } from '../model/units';
import { decodeText, extension, stem, type InputFile } from '../io/text';

export { parseCfg } from './cfg';

/** Тип величини за назвою, якщо одиниця не дозволяє визначити. */
function kindFromName(name: string): 'U' | 'I' | 'other' {
  const n = latinize(name).toLowerCase();
  if (/(^|[^a-z])(u|v)(a|b|c|l[123]|n|0|e|ab|bc|ca)?([^a-z]|$)|voltage|напруг/.test(n)) return 'U';
  if (/(^|[^a-z])i(a|b|c|l[123]|n|0|e)?([^a-z]|$)|current|струм/.test(n)) return 'I';
  return 'other';
}

/** Заповнення пропусків попереднім значенням. */
function fillGaps(x: Float64Array): void {
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) x[i] = last;
    else last = x[i];
  }
}

function buildTime(cfg: ComtradeCfg, n: number, stamp: Float64Array): Float64Array {
  const t = new Float64Array(n);
  const useRates = cfg.rates.length > 0 && cfg.rates[0].samp > 0;
  if (useRates) {
    let i = 0;
    let t0 = 0;
    for (const r of cfg.rates) {
      const dt = 1 / r.samp;
      const end = Math.min(n, r.endsamp > 0 ? r.endsamp : n);
      const startIdx = i;
      for (; i < end; i++) t[i] = t0 + (i - startIdx) * dt;
      t0 = i > 0 ? t[i - 1] + dt : 0;
    }
    for (; i < n; i++) t[i] = t[i - 1] + 1 / cfg.rates[cfg.rates.length - 1].samp;
  } else {
    const s0 = stamp[0];
    for (let i = 0; i < n; i++) t[i] = (stamp[i] - s0) * cfg.timemult * 1e-6;
  }
  return t;
}

export function buildComtradeRecord(cfg: ComtradeCfg, datBytes: Uint8Array, id: string, files: string[]): Oscillogram {
  const raw = parseDat(cfg, datBytes);
  // Кількість відліків — за останнім endsamp CFG (деякі терміналі дописують зайвий відлік).
  const lastEnd = cfg.rates.length ? cfg.rates[cfg.rates.length - 1].endsamp : 0;
  const n = lastEnd > 0 ? Math.min(lastEnd, raw.sampleNo.length) : raw.sampleNo.length;
  const time = buildTime(cfg, n, raw.stamp);

  const analog: AnalogChannel[] = cfg.analog.map((c, k) => {
    const ui = unitInfo(c.unit);
    const kind = ui.kind !== 'other' ? ui.kind : kindFromName(c.id + ' ' + c.phase);
    const src = raw.analog[k];
    const data = new Float64Array(n);
    // Перерахунок у первинні: P — значення вже первинні; S — множимо на коефіцієнт трансформації.
    const ratio = c.ps === 'S' ? c.primary / c.secondary : 1;
    const f = ui.factor * ratio;
    for (let i = 0; i < n; i++) data[i] = (c.a * src[i] + c.b) * f;
    fillGaps(data);
    return {
      index: c.index,
      name: c.phase && !c.id.toLowerCase().includes(c.phase.toLowerCase()) ? `${c.id} ${c.phase}` : c.id,
      phase: c.phase,
      circuit: c.circuit,
      unit: ui.kind !== 'other' ? ui.base : c.unit,
      kind,
      data,
      primary: c.primary,
      secondary: c.secondary,
    };
  });

  const digital: DigitalChannel[] = cfg.digital.map((d, k) => ({
    index: d.index,
    name: d.id,
    circuit: d.circuit,
    data: raw.digital[k],
  }));

  const trig = cfg.triggerSeconds - cfg.startSeconds;
  return {
    id,
    station: cfg.station,
    device: cfg.device,
    frequency: cfg.frequency,
    time,
    triggerTime: Number.isFinite(trig) ? trig : 0,
    startStamp: cfg.start,
    triggerStamp: cfg.trigger,
    analog,
    digital,
    source: { format: 'COMTRADE', revision: cfg.revision, files, notes: [] },
  };
}

/** Групування файлів COMTRADE за іменем та завантаження всіх знайдених пар CFG+DAT. */
export function loadComtradeFiles(files: InputFile[]): { records: Oscillogram[]; errors: string[] } {
  const groups = new Map<string, Map<string, InputFile>>();
  for (const f of files) {
    const ext = extension(f.name);
    if (!['cfg', 'dat', 'hdr', 'inf'].includes(ext)) continue;
    const key = stem(f.name).toLowerCase();
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key)!.set(ext, f);
  }
  const records: Oscillogram[] = [];
  const errors: string[] = [];
  for (const [key, g] of groups) {
    const cfgF = g.get('cfg');
    const datF = g.get('dat');
    if (!cfgF) continue;
    if (!datF) {
      errors.push(`${cfgF.name}: відсутній файл DAT`);
      continue;
    }
    try {
      const cfg = parseCfg(decodeText(cfgF.bytes));
      const rec = buildComtradeRecord(cfg, datF.bytes, key, [cfgF.name, datF.name]);
      const hdrF = g.get('hdr');
      if (hdrF) {
        rec.source.files.push(hdrF.name);
        const ref = parseAbbHdr(decodeText(hdrF.bytes));
        if (ref) rec.reference = ref;
      }
      records.push(rec);
    } catch (e) {
      errors.push(`${cfgF.name}: ${(e as Error).message}`);
    }
  }
  return { records, errors };
}
