import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZones, mhoPolygon, parseRio, pointInPolygon, quadPolygon, zonePolygon, type Pt } from '../src/analysis/zones';
import { SAMPLES } from './helpers';

const rio = parseRio(new TextDecoder('windows-1251').decode(readFileSync(join(SAMPLES, 'siprotec', 'FAULT.rio'))));

function samePolygon(a: Pt[], b: Pt[], tol = 1e-3) {
  // Кожна вершина одного полігона збігається з вершиною іншого.
  expect(a.length).toBe(b.length);
  for (const p of a) expect(b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol), `вершина ${p}`).toBe(true);
}

describe('RIO (OMICRON) з 7SA513', () => {
  it('читає пристрій, номінали та зони', () => {
    expect(rio.device).toContain('7SA513');
    expect(rio.rating).toEqual([100, 1, 50]);
    expect(rio.lineAngle).toBe(75);
    const names = [...new Set(rio.zones.map((z) => z.name))];
    expect(names).toEqual(expect.arrayContaining(['Z1', 'Z2', 'Z3', 'Z1B', 'Z1L']));
    const z2pe = rio.zones.find((z) => z.name === 'Z2' && z.family === 'pe')!;
    expect(z2pe.timeS).toBe(0.9);
    expect(z2pe.units).toBe('sec');
  });

  it('шаблон 7SA відтворює полігон Z1 з RIO', () => {
    const z1 = rio.zones.find((z) => z.name === 'Z1' && z.family === 'pp')!;
    const tpl = quadPolygon({ x: 16, r: 6.8, sideAngle: 90, topTilt: 0, dirLower: -22, dirUpper: 120, direction: 'forward' });
    samePolygon(tpl, zonePolygon(z1));
  });

  it('шаблон 7SA відтворює полігон Z2 (ф-з) з RIO', () => {
    const z2 = rio.zones.find((z) => z.name === 'Z2' && z.family === 'pe')!;
    const [zone] = buildZones({
      id: 'z2',
      name: 'Z2',
      template: '7sa',
      params: { X: 26.93, R: 12.27, RE: 11.73, sideAngle: 90, alpha: 0, dirLower: -22, dirUpper: 120 },
      direction: 'forward',
      families: ['pe'],
      units: 'sec',
      enabled: true,
    });
    samePolygon(zonePolygon(zone), zonePolygon(z2), 2e-3);
  });
});

describe('Геометрія характеристик', () => {
  it('точка всередині/поза полігоном', () => {
    const p = quadPolygon({ x: 10, r: 5, sideAngle: 90, topTilt: 0, dirLower: -15, dirUpper: 115, direction: 'forward' });
    expect(pointInPolygon([2, 5], p)).toBe(true);
    expect(pointInPolygon([6, 5], p)).toBe(false);
    expect(pointInPolygon([-2, -5], p)).toBe(false);
  });

  it('зворотна зона — дзеркальна', () => {
    const p = quadPolygon({ x: 10, r: 5, sideAngle: 90, topTilt: 0, dirLower: -15, dirUpper: 115, direction: 'reverse' });
    expect(pointInPolygon([-2, -5], p)).toBe(true);
    expect(pointInPolygon([2, 5], p)).toBe(false);
  });

  it('коло mho проходить через початок координат і точку уставки', () => {
    const pts = mhoPolygon({ reach: 10, angle: 90, offset: 0 }, 360);
    expect(pointInPolygon([0, 9.9], pts)).toBe(true);
    expect(pointInPolygon([0, 10.1], pts)).toBe(false);
    expect(pointInPolygon([0, -0.1], pts)).toBe(false);
  });

  it('REL670 ф-з: межа X у площині прямої послідовності дорівнює X1', () => {
    const [zone] = buildZones({
      id: 'z1',
      name: 'Z1',
      template: 'rel670',
      params: { X1: 20, R1: 2, X0: 60, R0: 20, RFPP: 10, RFPE: 0.001, ArgDir: 15, ArgNegRes: 115 },
      direction: 'forward',
      families: ['pe'],
      units: 'prim',
      enabled: true,
    });
    const poly = zonePolygon(zone);
    // Металеве КЗ у кінці зони: Z = Z1 → на межі; 0,98·Z1 — всередині, 1,02·Z1 — поза.
    expect(pointInPolygon([2 * 0.98, 20 * 0.98], poly)).toBe(true);
    expect(pointInPolygon([2 * 1.02, 20 * 1.02], poly)).toBe(false);
  });
});
