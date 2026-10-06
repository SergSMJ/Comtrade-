/**
 * Характеристики зон дистанційного захисту на площині R-X.
 *
 * Площина відображення — опір прямої послідовності «на фазу»:
 *  міжфазні петлі Z = (Ux−Uy)/(Ix−Iy); петлі фаза-земля — з компенсацією k0.
 * Характеристики, задані виробником у «петлевій» площині (ABB, фаза-земля), переводяться
 * у площину прямої послідовності діленням на (1 + k0): Z_петлі = Z₁ · (1 + k0).
 */
import { add, c, div, type C } from '../dsp/complex';

export type Pt = [number, number];
export type Direction = 'forward' | 'reverse' | 'non';
export type LoopFamily = 'pp' | 'pe';

export interface QuadParams {
  /** Реактивна межа, Ом. */
  x: number;
  /** Активна межа праворуч (горизонтальна відстань від лінії через початок координат), Ом. */
  r: number;
  /** Активна межа ліворуч, Ом (за замовчуванням = r). */
  rLeft?: number;
  /** Кут нахилу бічних меж, ° (90 — вертикальні; кут лінії — паралельні лінії). */
  sideAngle: number;
  /** Нахил верхньої межі вниз праворуч, °. */
  topTilt: number;
  /** Нижня межа органу напрямку (IV квадрант), °. Напр. −15. */
  dirLower: number;
  /** Верхня межа органу напрямку (II квадрант), °. Напр. 115. */
  dirUpper: number;
  direction: Direction;
  /** Реактивна межа у зворотному напрямку для ненапрямленої зони, Ом. */
  xRev?: number;
}

export interface MhoParams {
  /** Уставка досягнення, Ом. */
  reach: number;
  /** Кут максимальної чутливості, °. */
  angle: number;
  /** Зміщення у зворотному напрямку, Ом (0 — самополяризоване коло). */
  offset: number;
}

export type ZoneShape =
  | { type: 'quad'; p: QuadParams }
  | { type: 'mho'; p: MhoParams }
  | { type: 'polygon'; points: Pt[] };

export interface Zone {
  id: string;
  name: string;
  family: LoopFamily;
  shape: ZoneShape;
  /** Одиниці, в яких задано характеристику. */
  units: 'prim' | 'sec';
  /** Множник переходу з петлевої площини у площину прямої послідовності (ABB ф-з): 1/(1+k0). */
  loopToPhase?: C;
  timeS?: number;
  color?: string;
  enabled: boolean;
  source?: string;
}

const d2r = Math.PI / 180;

/* ------------------------- Геометрія ------------------------- */

type HalfPlane = { p0: Pt; dir: Pt; keepLeft: boolean };

function clip(poly: Pt[], hp: HalfPlane): Pt[] {
  const side = (p: Pt) => {
    const cr = hp.dir[0] * (p[1] - hp.p0[1]) - hp.dir[1] * (p[0] - hp.p0[0]);
    return hp.keepLeft ? cr : -cr;
  };
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

const dirOf = (deg: number): Pt => [Math.cos(deg * d2r), Math.sin(deg * d2r)];

/** Полігон чотирикутної характеристики (прямий напрямок; зворотний — дзеркально). */
export function quadPolygon(q: QuadParams): Pt[] {
  const big = 20 * Math.max(Math.abs(q.x), Math.abs(q.r), Math.abs(q.rLeft ?? q.r), 1);
  let poly: Pt[] = [
    [-big, -big],
    [big, -big],
    [big, big],
    [-big, big],
  ];
  const rl = q.rLeft ?? q.r;
  const side = dirOf(q.sideAngle);
  poly = clip(poly, { p0: [0, q.x], dir: dirOf(-q.topTilt), keepLeft: false });
  poly = clip(poly, { p0: [q.r, 0], dir: side, keepLeft: true });
  poly = clip(poly, { p0: [-rl, 0], dir: side, keepLeft: false });
  if (q.direction === 'non') {
    const xr = q.xRev ?? q.x;
    poly = clip(poly, { p0: [0, -xr], dir: dirOf(-q.topTilt), keepLeft: true });
  } else {
    poly = clip(poly, { p0: [0, 0], dir: dirOf(q.dirLower), keepLeft: true });
    poly = clip(poly, { p0: [0, 0], dir: dirOf(q.dirUpper), keepLeft: false });
  }
  if (q.direction === 'reverse') poly = poly.map(([r, x]) => [-r, -x] as Pt);
  return dedupe(poly);
}

function dedupe(poly: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-9) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

export function mhoPolygon(m: MhoParams, segments = 180): Pt[] {
  const a = m.angle * d2r;
  const fwd: Pt = [m.reach * Math.cos(a), m.reach * Math.sin(a)];
  const rev: Pt = [-m.offset * Math.cos(a), -m.offset * Math.sin(a)];
  const cx = (fwd[0] + rev[0]) / 2;
  const cy = (fwd[1] + rev[1]) / 2;
  const rad = (m.reach + m.offset) / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    pts.push([cx + rad * Math.cos(t), cy + rad * Math.sin(t)]);
  }
  return pts;
}

/** Полігон зони в одиницях її задання, у площині прямої послідовності. */
export function zonePolygon(z: Zone): Pt[] {
  let pts: Pt[];
  switch (z.shape.type) {
    case 'quad':
      pts = quadPolygon(z.shape.p);
      break;
    case 'mho':
      pts = mhoPolygon(z.shape.p);
      break;
    default:
      pts = z.shape.points;
  }
  if (z.loopToPhase) {
    const k = z.loopToPhase;
    pts = pts.map(([r, x]) => [r * k.re - x * k.im, r * k.im + x * k.re] as Pt);
  }
  return pts;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------- Шаблони терміналів ------------------------- */

export type TemplateId = 'generic-quad' | 'generic-mho' | 'rel670' | '7sa' | 'pcs902-quad' | 'pcs902-mho';

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  'generic-quad': 'Універсальний полігон',
  'generic-mho': 'Коло (mho / зміщене)',
  rel670: 'ABB REL670 — ZMQPDIS (полігон)',
  '7sa': 'Siemens SIPROTEC 7SA — полігон',
  'pcs902-quad': 'NR PCS-902/931 — полігон',
  'pcs902-mho': 'NR PCS-902/931 — mho',
};

/** Опис параметрів шаблону для форми введення. */
export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  def: number;
  note?: string;
}

export const TEMPLATE_PARAMS: Record<TemplateId, ParamDef[]> = {
  'generic-quad': [
    { key: 'x', label: 'X', unit: 'Ом', def: 10 },
    { key: 'r', label: 'R (праворуч)', unit: 'Ом', def: 5 },
    { key: 'rLeft', label: 'R (ліворуч)', unit: 'Ом', def: 5 },
    { key: 'sideAngle', label: 'Нахил бічних меж', unit: '°', def: 90 },
    { key: 'topTilt', label: 'Нахил верхньої межі', unit: '°', def: 0 },
    { key: 'dirLower', label: 'Межа ОН у IV квадранті', unit: '°', def: -15 },
    { key: 'dirUpper', label: 'Межа ОН у II квадранті', unit: '°', def: 115 },
  ],
  'generic-mho': [
    { key: 'reach', label: 'Zуст', unit: 'Ом', def: 10 },
    { key: 'angle', label: 'φм.ч.', unit: '°', def: 75 },
    { key: 'offset', label: 'Зміщення назад', unit: 'Ом', def: 0 },
  ],
  rel670: [
    { key: 'X1', label: 'X1', unit: 'Ом/фазу', def: 10 },
    { key: 'R1', label: 'R1', unit: 'Ом/фазу', def: 1 },
    { key: 'X0', label: 'X0', unit: 'Ом/фазу', def: 30 },
    { key: 'R0', label: 'R0', unit: 'Ом/фазу', def: 3 },
    { key: 'RFPP', label: 'RFPP', unit: 'Ом/петлю', def: 10 },
    { key: 'RFPE', label: 'RFPE', unit: 'Ом/петлю', def: 15 },
    { key: 'ArgDir', label: 'ArgDir (ZDRDIR)', unit: '°', def: 15 },
    { key: 'ArgNegRes', label: 'ArgNegRes (ZDRDIR)', unit: '°', def: 115 },
  ],
  '7sa': [
    { key: 'X', label: 'X (Zi)', unit: 'Ом', def: 10 },
    { key: 'R', label: 'R (Zi), ф-ф', unit: 'Ом', def: 5 },
    { key: 'RE', label: 'RE (Zi), ф-з', unit: 'Ом', def: 8 },
    { key: 'sideAngle', label: 'Нахил R-меж (кут лінії; 90 — 7SA513)', unit: '°', def: 90 },
    { key: 'alpha', label: 'Нахил зони α', unit: '°', def: 0 },
    { key: 'dirLower', label: 'Межа ОН у IV квадранті', unit: '°', def: -22, note: 'значення з RIO 7SA513; перевірте для вашої версії' },
    { key: 'dirUpper', label: 'Межа ОН у II квадранті', unit: '°', def: 120, note: 'значення з RIO 7SA513; перевірте для вашої версії' },
  ],
  'pcs902-quad': [
    { key: 'Z_Set', label: 'Z_Set (досягнення по X)', unit: 'Ом', def: 10 },
    { key: 'R_Set', label: 'R_Set', unit: 'Ом', def: 5 },
    { key: 'phi', label: 'φ лінії (бічні межі)', unit: '°', def: 80 },
    { key: 'topTilt', label: 'Нахил верхньої межі', unit: '°', def: 0, note: 'перевірте за інструкцією термінала' },
    { key: 'dirLower', label: 'Межа ОН у IV квадранті', unit: '°', def: -15, note: 'перевірте за інструкцією термінала' },
    { key: 'dirUpper', label: 'Межа ОН у II квадранті', unit: '°', def: 115, note: 'перевірте за інструкцією термінала' },
  ],
  'pcs902-mho': [
    { key: 'Z_Set', label: 'Z_Set', unit: 'Ом', def: 10 },
    { key: 'phi', label: 'φ лінії', unit: '°', def: 80 },
    { key: 'Z_Rev', label: 'Зміщення назад', unit: 'Ом', def: 0 },
  ],
};

export interface ZoneSpec {
  id: string;
  name: string;
  template: TemplateId;
  params: Record<string, number>;
  direction: Direction;
  /** Для яких петель будувати: обидві сім'ї або одна. */
  families: LoopFamily[];
  units: 'prim' | 'sec';
  timeS?: number;
  color?: string;
  enabled: boolean;
}

/**
 * Перетворення специфікації зони (шаблон + уставки) у характеристики для кожної сім'ї петель.
 */
export function buildZones(spec: ZoneSpec): Zone[] {
  const P = (k: string, d = 0) => spec.params[k] ?? d;
  const base = { units: spec.units, timeS: spec.timeS, color: spec.color, enabled: spec.enabled, source: TEMPLATE_LABELS[spec.template] };
  const out: Zone[] = [];
  for (const fam of spec.families) {
    const id = `${spec.id}-${fam}`;
    const name = spec.name;
    let shape: ZoneShape;
    let loopToPhase: C | undefined;
    switch (spec.template) {
      case 'generic-quad':
        shape = {
          type: 'quad',
          p: { x: P('x'), r: P('r'), rLeft: P('rLeft', P('r')), sideAngle: P('sideAngle', 90), topTilt: P('topTilt'), dirLower: P('dirLower', -15), dirUpper: P('dirUpper', 115), direction: spec.direction },
        };
        break;
      case 'generic-mho':
        shape = { type: 'mho', p: { reach: P('reach'), angle: P('angle', 75), offset: P('offset') } };
        if (spec.direction === 'reverse') shape.p.angle += 180;
        break;
      case 'rel670': {
        const X1 = P('X1');
        const R1 = P('R1');
        const dir = { dirLower: -P('ArgDir', 15), dirUpper: P('ArgNegRes', 115), direction: spec.direction };
        if (fam === 'pp') {
          // Площина «на фазу»: X1; активна межа RFPP/2; бічні межі паралельні Z1.
          shape = { type: 'quad', p: { x: X1, r: P('RFPP') / 2, sideAngle: (Math.atan2(X1, R1) * 180) / Math.PI, topTilt: 0, ...dir } };
        } else {
          // Петлева площина: Xпет = (2X1+X0)/3, Rпет = (2R1+R0)/3, межа RFPE; далі ÷(1+k0).
          const xl = (2 * X1 + P('X0')) / 3;
          const rlp = (2 * R1 + P('R0')) / 3;
          shape = { type: 'quad', p: { x: xl, r: P('RFPE'), sideAngle: (Math.atan2(xl, rlp) * 180) / Math.PI, topTilt: 0, ...dir } };
          const k0 = div(c(P('R0') - R1, P('X0') - X1), c(3 * R1, 3 * X1));
          loopToPhase = div(c(1), add(c(1), k0));
        }
        break;
      }
      case '7sa':
        shape = {
          type: 'quad',
          p: {
            x: P('X'),
            r: fam === 'pp' ? P('R') : P('RE'),
            sideAngle: P('sideAngle', 90),
            topTilt: P('alpha'),
            dirLower: P('dirLower', -22),
            dirUpper: P('dirUpper', 120),
            direction: spec.direction,
          },
        };
        break;
      case 'pcs902-quad':
        shape = {
          type: 'quad',
          p: { x: P('Z_Set'), r: P('R_Set'), sideAngle: P('phi', 80), topTilt: P('topTilt'), dirLower: P('dirLower', -15), dirUpper: P('dirUpper', 115), direction: spec.direction },
        };
        break;
      case 'pcs902-mho':
        shape = { type: 'mho', p: { reach: P('Z_Set'), angle: P('phi', 80) + (spec.direction === 'reverse' ? 180 : 0), offset: P('Z_Rev') } };
        break;
    }
    out.push({ ...base, id, name, family: fam, shape, loopToPhase });
  }
  return out;
}

/* ------------------------- Імпорт RIO (OMICRON) ------------------------- */

export interface RioImport {
  device: string;
  zones: Zone[];
  warnings: string[];
  /** Номінальні вторинні величини (RATING): U, I, f. */
  rating?: [number, number, number];
  lineAngle?: number;
  rerl?: number;
  xexl?: number;
}

/** Розбір характеристик з RIO-файлу (блоки PROTECTIONDEVICE / ZONE / TRIPCHAR). */
export function parseRio(text: string): RioImport {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const res: RioImport = { device: '', zones: [], warnings: [] };
  let zone: { name: string; kind: string; time?: number; pp?: Pt[]; pe?: Pt[] } | null = null;
  let charKind: 'pp' | 'pe' | null = null;
  let pts: Pt[] = [];
  let n = 0;
  const nums = (s: string) => s.split(',').map((v) => Number(v.trim()));
  for (const l of lines) {
    const [key, ...restArr] = l.split(/\s+/);
    const rest = restArr.join(' ');
    switch (key) {
      case 'DEVICE':
        res.device = rest;
        break;
      case 'RATING':
        res.rating = nums(rest).slice(0, 3) as [number, number, number];
        break;
      case 'LINEANGLE':
        res.lineAngle = Number(rest);
        break;
      case 'RE/RL':
        res.rerl = Number(rest);
        break;
      case 'XE/XL':
        res.xexl = Number(rest);
        break;
      case 'BEGIN':
        if (restArr[0]?.startsWith('ZONE')) zone = { name: '', kind: restArr[0] };
        else if (restArr[0] === 'TRIPCHAR' || restArr[0] === 'TRIPCHAR-EARTH') {
          charKind = restArr[0] === 'TRIPCHAR' ? 'pp' : 'pe';
          pts = [];
        }
        break;
      case 'NAME':
        if (zone) zone.name = rest;
        break;
      case 'TIME1':
        if (zone) zone.time = Number(rest);
        break;
      case 'START':
      case 'LINE':
        if (charKind) {
          const [r, x] = nums(rest);
          pts.push([r, x]);
        }
        break;
      case 'LINEP':
        if (charKind) {
          const [m, a] = nums(rest);
          pts.push([m * Math.cos(a * d2r), m * Math.sin(a * d2r)]);
        }
        break;
      case 'ARC':
      case 'ARCP':
        if (charKind) res.warnings.push(`Зона ${zone?.name ?? '?'}: дуги RIO (ARC) апроксимуються відрізком`);
        break;
      case 'END':
        if ((restArr[0] === 'TRIPCHAR' || restArr[0] === 'TRIPCHAR-EARTH') && zone && charKind) {
          zone[charKind] = pts;
          charKind = null;
        } else if (restArr[0]?.startsWith('ZONE') && zone) {
          const label = zone.kind === 'ZONE-START' ? `${zone.name} (пуск)` : zone.name;
          for (const fam of ['pp', 'pe'] as const) {
            const p = zone[fam];
            if (!p || p.length < 3) continue;
            res.zones.push({
              id: `rio-${n}-${fam}`,
              name: label,
              family: fam,
              shape: { type: 'polygon', points: p },
              units: 'sec',
              timeS: zone.time !== undefined && zone.time < 1e6 ? zone.time : undefined,
              enabled: zone.kind !== 'ZONE-START',
              source: `RIO: ${res.device}`,
            });
          }
          n++;
          zone = null;
        }
        break;
    }
  }
  return res;
}
