import { describe, expect, it } from 'vitest';
import { loadComtradeFiles } from '../src/comtrade';
import { loadReginaFiles } from '../src/regina';
import { loadDir, rms } from './helpers';

describe('COMTRADE: ABB REL670 (1999, BINARY)', () => {
  const { records, errors } = loadComtradeFiles(loadDir('rel670'));
  const rec = records[0];

  it('завантажується без помилок', () => {
    expect(errors).toEqual([]);
    expect(records).toHaveLength(1);
    expect(rec.analog).toHaveLength(13);
    expect(rec.digital).toHaveLength(96);
    expect(rec.time).toHaveLength(9876);
    expect(rec.frequency).toBe(50);
  });

  it('час пуску відносно початку запису', () => {
    expect(rec.triggerTime).toBeCloseTo(0.500317, 5);
  });

  it('доаварійна напруга ≈ номінальній фазній 750 кВ', () => {
    const ua = rec.analog.find((c) => c.name === 'LINE VT A UL1')!;
    expect(ua.kind).toBe('U');
    expect(ua.unit).toBe('V');
    const u = rms(ua.data, 0, 400);
    expect(u).toBeGreaterThan(400e3);
    expect(u).toBeLessThan(470e3);
  });

  it('читає еталонні значення HDR', () => {
    expect(rec.reference?.channels).toHaveLength(18);
    expect(rec.reference?.faultDistance).toBeCloseTo(1.236117, 5);
  });
});

describe('COMTRADE: Siemens 7SA513 (1997 → як 1999, BINARY, cp1251)', () => {
  const { records, errors } = loadComtradeFiles(loadDir('siprotec'));
  const rec = records[0];
  it('завантажується', () => {
    expect(errors).toEqual([]);
    expect(rec.station).toContain('Папка');
    expect(rec.analog).toHaveLength(9);
    expect(rec.digital).toHaveLength(22);
    expect(rec.time).toHaveLength(4995);
  });
});

describe('«Регіна»', () => {
  const { records, errors } = loadReginaFiles(loadDir('regina'));

  it('розшифровує обидва записи', () => {
    expect(errors).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0].station).toBe('Хмельницкая АЭС');
    for (const r of records) {
      expect(r.analog).toHaveLength(32);
      expect(r.time).toHaveLength(5000);
    }
  });

  it('масштаб: доаварійна напруга шин 750 кВ — 430…440 кВ фазної', () => {
    const r3 = records.find((r) => r.device.includes('реєстратор 3'))!;
    const ua = r3.analog.find((c) => c.name.startsWith('Ua 1СШ'))!;
    const u = rms(ua.data, 0, 100);
    expect(u).toBeGreaterThan(425e3);
    expect(u).toBeLessThan(445e3);
  });

  it('дискретні події реєстратора 3 присутні', () => {
    const r3 = records.find((r) => r.device.includes('реєстратор 3'))!;
    const changed = r3.digital.filter((d) => d.data.some((v) => v !== d.data[0]));
    expect(changed.length).toBeGreaterThan(5);
  });
});
