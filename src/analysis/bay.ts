/**
 * Приєднання (bay): призначення каналів осцилограми фазам U/I.
 * Автопідбір за назвою, полем ph, одиницями; користувач коригує вручну.
 */
import type { AnalogChannel, Oscillogram } from '../model/record';
import { latinize } from '../model/units';

export type PhaseSlot = 'a' | 'b' | 'c' | 'n';
export const SLOTS: PhaseSlot[] = ['a', 'b', 'c', 'n'];

export interface BayMap {
  name: string;
  /** Індекси в rec.analog або null. */
  i: Record<PhaseSlot, number | null>;
  u: Record<PhaseSlot, number | null>;
  /** Інверсія полярності окремих каналів (за індексом rec.analog). */
  invert: number[];
}

export interface ChannelPhase {
  slot: PhaseSlot | null;
  /** Назва без фазного токена — ключ групування. */
  group: string;
}

/** Розпізнавання фази з назви каналу та поля ph. */
export function detectPhase(ch: AnalogChannel): ChannelPhase {
  const src = latinize(`${ch.name}`);
  const tokens = src.split(/[\s,;:_\-/()[\]{}.]+/).filter(Boolean);
  const ph = latinize(ch.phase).toLowerCase().trim();

  const prefixed = (t: string): PhaseSlot | null => {
    const s = t.toLowerCase();
    if (/^3[iu]0$|^[iu]0$|^3[iu]o$|^[iu](n|e|en|res)$/.test(s)) return 'n';
    const m = /^[iu](l?([123])|([abc]))$/.exec(s);
    if (m) return m[2] ? (['a', 'b', 'c'][Number(m[2]) - 1] as PhaseSlot) : (m[3] as PhaseSlot);
    return null;
  };
  const bare = (t: string): PhaseSlot | null => {
    const s = t.toLowerCase();
    if (/^l[123]$/.test(s)) return ['a', 'b', 'c'][Number(s[1]) - 1] as PhaseSlot;
    if (/^[abc]$/.test(s)) return s as PhaseSlot;
    if (/^(n|e|0|3i0|3u0)$/.test(s)) return 'n';
    return null;
  };

  let slot: PhaseSlot | null = null;
  let hit = -1;
  tokens.forEach((t, k) => {
    if (slot === null) {
      const s = prefixed(t);
      if (s) {
        slot = s;
        hit = k;
      }
    }
  });
  if (slot === null && ph) {
    slot = bare(ph) ?? prefixed(ph);
  }
  if (slot === null) {
    // Голий токен — лише останній (щоб «CT A IL1» не сприймалось як фаза A від «A»).
    for (let k = tokens.length - 1; k >= 0 && slot === null; k--) {
      const s = bare(tokens[k]);
      if (s) {
        slot = s;
        hit = k;
      }
    }
  }
  const group = tokens
    .filter((_, k) => k !== hit)
    .join(' ')
    .trim();
  return { slot, group: group || ch.circuit || '—' };
}

interface Group {
  key: string;
  kind: 'U' | 'I';
  slots: Partial<Record<PhaseSlot, number>>;
  circuit: string;
}

function groupKey(ch: AnalogChannel, cp: ChannelPhase): string {
  // Для «Регіни» група з RgSet надійніша за назву.
  return ch.circuit.startsWith('G') && /^G\d+$/.test(ch.circuit) ? ch.circuit + '|' + cp.group : cp.group;
}

function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/));
  const tb = b.toLowerCase().split(/\s+/);
  let s = 0;
  for (const t of tb) if (ta.has(t)) s++;
  return s;
}

/** Автоматичне формування приєднань: трійки струмів + відповідна трійка напруг. */
export function autoDetectBays(rec: Oscillogram): BayMap[] {
  const groups = new Map<string, Group>();
  rec.analog.forEach((ch, idx) => {
    if (ch.kind === 'other') return;
    const cp = detectPhase(ch);
    if (!cp.slot) return;
    const key = ch.kind + '|' + groupKey(ch, cp);
    let g = groups.get(key);
    if (!g) {
      g = { key: cp.group, kind: ch.kind, slots: {}, circuit: ch.circuit };
      groups.set(key, g);
    }
    if (g.slots[cp.slot] === undefined) g.slots[cp.slot] = idx;
  });
  const full = (g: Group) => g.slots.a !== undefined && g.slots.b !== undefined && g.slots.c !== undefined;
  const iGroups = [...groups.values()].filter((g) => g.kind === 'I' && full(g));
  const uGroups = [...groups.values()].filter((g) => g.kind === 'U' && full(g));

  const bays: BayMap[] = iGroups.map((ig) => {
    let best: Group | undefined;
    let bestScore = -1;
    for (const ug of uGroups) {
      let s = similarity(ig.key, ug.key) * 2;
      if (ig.circuit && ig.circuit === ug.circuit) s += 5;
      if (s > bestScore) {
        bestScore = s;
        best = ug;
      }
    }
    // Якщо немає спільних ознак — вибирається перша трійка напруг (користувач перевіряє).
    const u = best ?? uGroups[0];
    return {
      name: ig.key,
      i: { a: ig.slots.a ?? null, b: ig.slots.b ?? null, c: ig.slots.c ?? null, n: ig.slots.n ?? null },
      u: { a: u?.slots.a ?? null, b: u?.slots.b ?? null, c: u?.slots.c ?? null, n: u?.slots.n ?? null },
      invert: [],
    };
  });
  return bays;
}

export function emptyBay(name = 'Приєднання'): BayMap {
  return { name, i: { a: null, b: null, c: null, n: null }, u: { a: null, b: null, c: null, n: null }, invert: [] };
}

/** Коефіцієнти трансформації приєднання (з каналів фази A). */
export function bayRatios(rec: Oscillogram, bay: BayMap): { ct: number; vt: number; ctText: string; vtText: string } {
  const ic = bay.i.a !== null ? rec.analog[bay.i.a] : undefined;
  const uc = bay.u.a !== null ? rec.analog[bay.u.a] : undefined;
  const ct = ic ? ic.primary / ic.secondary : 1;
  const vt = uc ? uc.primary / uc.secondary : 1;
  return {
    ct,
    vt,
    ctText: ic ? `${ic.primary}/${ic.secondary} А` : '—',
    vtText: uc ? `${uc.primary}/${uc.secondary} В` : '—',
  };
}
