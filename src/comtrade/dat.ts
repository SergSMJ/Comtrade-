/**
 * Розбір файлу даних COMTRADE: ASCII, BINARY (int16), BINARY32 (int32), FLOAT32.
 */
import type { ComtradeCfg } from './cfg';

export interface RawData {
  /** Номери відліків з файлу. */
  sampleNo: Float64Array;
  /** Мітки часу з файлу (у одиницях timemult·мкс), NaN якщо відсутні. */
  stamp: Float64Array;
  /** Сирі значення аналогових каналів (NaN — пропуск). */
  analog: Float64Array[];
  digital: Uint8Array[];
}

const ASCII_MISSING = 99999;

export function parseDat(cfg: ComtradeCfg, bytes: Uint8Array): RawData {
  return cfg.format === 'ASCII' ? parseAscii(cfg, bytes) : parseBinary(cfg, bytes);
}

function alloc(cfg: ComtradeCfg, n: number): RawData {
  return {
    sampleNo: new Float64Array(n),
    stamp: new Float64Array(n),
    analog: cfg.analog.map(() => new Float64Array(n)),
    digital: cfg.digital.map(() => new Uint8Array(n)),
  };
}

function parseBinary(cfg: ComtradeCfg, bytes: Uint8Array): RawData {
  const nA = cfg.analog.length;
  const nD = cfg.digital.length;
  const aSize = cfg.format === 'BINARY' ? 2 : 4;
  const words = Math.ceil(nD / 16);
  const recSize = 8 + nA * aSize + words * 2;
  const n = Math.floor(bytes.length / recSize);
  if (n === 0) throw new Error('DAT: файл порожній або не відповідає CFG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = alloc(cfg, n);
  for (let i = 0; i < n; i++) {
    let o = i * recSize;
    out.sampleNo[i] = view.getUint32(o, true);
    const ts = view.getUint32(o + 4, true);
    out.stamp[i] = ts === 0xffffffff ? NaN : ts;
    o += 8;
    for (let c = 0; c < nA; c++) {
      let v: number;
      if (cfg.format === 'BINARY') {
        const r = view.getInt16(o, true);
        v = r === -32768 ? NaN : r;
      } else if (cfg.format === 'BINARY32') {
        const r = view.getInt32(o, true);
        v = r === -2147483648 ? NaN : r;
      } else {
        v = view.getFloat32(o, true);
      }
      out.analog[c][i] = v;
      o += aSize;
    }
    for (let w = 0; w < words; w++) {
      const word = view.getUint16(o, true);
      o += 2;
      for (let b = 0; b < 16; b++) {
        const d = w * 16 + b;
        if (d < nD) out.digital[d][i] = (word >> b) & 1;
      }
    }
  }
  return out;
}

function parseAscii(cfg: ComtradeCfg, bytes: Uint8Array): RawData {
  const text = new TextDecoder('latin1').decode(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && l.trim() !== '\x1a');
  const n = lines.length;
  const nA = cfg.analog.length;
  const nD = cfg.digital.length;
  const out = alloc(cfg, n);
  for (let i = 0; i < n; i++) {
    const f = lines[i].split(',');
    out.sampleNo[i] = Number(f[0]);
    const ts = f[1]?.trim();
    out.stamp[i] = ts === undefined || ts === '' ? NaN : Number(ts);
    for (let c = 0; c < nA; c++) {
      const s = f[2 + c]?.trim();
      const v = s === undefined || s === '' ? NaN : Number(s);
      out.analog[c][i] = v === ASCII_MISSING ? NaN : v;
    }
    for (let d = 0; d < nD; d++) {
      out.digital[d][i] = Number(f[2 + nA + d]) ? 1 : 0;
    }
  }
  return out;
}
