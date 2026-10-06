/**
 * Стан застосунку, довідник приєднань (localStorage) та файл проєкту (JSON).
 */
import type { Oscillogram } from '../model/record';
import type { AnalysisGrid } from '../dsp/resample';
import type { FilterOptions } from '../dsp/phasor';
import type { BayMap } from '../analysis/bay';
import { compensationFromLine, type Compensation, type LoopId } from '../analysis/compute';
import { polar, rad, type C } from '../dsp/complex';
import type { Zone, ZoneSpec } from '../analysis/zones';

export interface LineSettings {
  /** Питомі параметри, Ом/км (первинні). */
  r1: number;
  x1: number;
  r0: number;
  x0: number;
  r0m: number;
  x0m: number;
  lengthKm: number;
  /** Спосіб компенсації струму землі. */
  compMode: 'line' | 'k0' | 'rexe';
  k0Mag: number;
  k0Ang: number;
  rerl: number;
  xexl: number;
  useMutual: boolean;
  /** Індекс каналу 3I0 паралельної лінії в rec.analog. */
  parallelIn: number | null;
  /** Мінімальний струм петлі для годографа, % від номінального первинного струму ТС. */
  iMinPct: number;
}

export interface BaySettings {
  line: LineSettings;
  zones: ZoneSpec[];
  rioZones: Zone[];
}

export function defaultLine(): LineSettings {
  return {
    r1: 0.03,
    x1: 0.28,
    r0: 0.2,
    x0: 0.9,
    r0m: 0,
    x0m: 0,
    lengthKm: 100,
    compMode: 'line',
    k0Mag: 0.7,
    k0Ang: -5,
    rerl: 1,
    xexl: 0.7,
    useMutual: false,
    parallelIn: null,
    iMinPct: 5,
  };
}

export function defaultBaySettings(): BaySettings {
  return { line: defaultLine(), zones: [], rioZones: [] };
}

/** Компенсація для розрахунку петель ф-з за параметрами приєднання. */
export function compensationOf(l: LineSettings): Compensation {
  const L = l.lengthKm || 1;
  const comp = compensationFromLine(l.r1 * L, l.x1 * L, l.r0 * L, l.x0 * L, l.r0m * L, l.x0m * L);
  comp.useMutual = l.useMutual && l.parallelIn !== null;
  if (l.compMode === 'k0') {
    comp.mode = 'k0';
    comp.k0 = polar(l.k0Mag, rad(l.k0Ang));
  } else if (l.compMode === 'rexe') {
    comp.mode = 'rexe';
    comp.rerl = l.rerl;
    comp.xexl = l.xexl;
  }
  return comp;
}

export function lineZ1(l: LineSettings): C {
  return { re: l.r1 * l.lengthKm, im: l.x1 * l.lengthKm };
}

export interface AppState {
  records: Oscillogram[];
  current: number;
  grid: AnalysisGrid | null;
  bays: BayMap[];
  bayIdx: number;
  /** Налаштування за назвою приєднання. */
  baySettings: Record<string, BaySettings>;
  filter: FilterOptions;
  units: 'prim' | 'sec';
  /** Курсор А (момент аналізу) і B (порівняння), с від першого відліку. */
  tA: number;
  tB: number;
  /** Інтервал годографа, мс відносно пуску. */
  hodoFromMs: number;
  hodoToMs: number;
  loops: LoopId[];
  selectedAnalog: number[];
  selectedDigital: number[];
  onlyChangedDigital: boolean;
  showRms: boolean;
  vectorRef: string;
  vectorSets: { phase: boolean; line: boolean; seq: boolean; compareB: boolean };
  tab: string;
}

export const state: AppState = {
  records: [],
  current: 0,
  grid: null,
  bays: [],
  bayIdx: 0,
  baySettings: {},
  filter: { method: 'dft1', mimicTauMs: 40 },
  units: 'prim',
  tA: 0,
  tB: 0,
  hodoFromMs: -20,
  hodoToMs: 150,
  loops: ['AB', 'BC', 'CA', 'AN', 'BN', 'CN'],
  selectedAnalog: [],
  selectedDigital: [],
  onlyChangedDigital: true,
  showRms: false,
  vectorRef: 'ua',
  vectorSets: { phase: true, line: false, seq: true, compareB: true },
  tab: 'data',
};

export function currentRecord(): Oscillogram | undefined {
  return state.grid?.rec;
}

export function currentBay(): BayMap | undefined {
  return state.bays[state.bayIdx];
}

export function settingsKey(rec: Oscillogram | undefined, bay: BayMap | undefined): string {
  return `${rec?.station ?? ''}|${bay?.name ?? ''}`;
}

export function currentSettings(): BaySettings {
  const key = settingsKey(currentRecord(), currentBay());
  if (!state.baySettings[key]) state.baySettings[key] = loadFromDirectory(key) ?? defaultBaySettings();
  return state.baySettings[key];
}

/* ----------------------- Довідник приєднань ----------------------- */

const DIR_KEY = 'comtrade-analyzer.directory.v1';

export interface DirectoryEntry {
  key: string;
  station: string;
  bay: string;
  settings: BaySettings;
  savedAt: string;
}

export function readDirectory(): DirectoryEntry[] {
  try {
    const raw = localStorage.getItem(DIR_KEY);
    return raw ? (JSON.parse(raw) as DirectoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeDirectory(entries: DirectoryEntry[]): boolean {
  try {
    localStorage.setItem(DIR_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function saveToDirectory(key: string, settings: BaySettings): boolean {
  const [station, bay] = key.split('|');
  const entries = readDirectory().filter((e) => e.key !== key);
  entries.push({ key, station, bay, settings: JSON.parse(JSON.stringify(settings)), savedAt: new Date().toISOString() });
  return writeDirectory(entries);
}

export function loadFromDirectory(key: string): BaySettings | undefined {
  const e = readDirectory().find((x) => x.key === key);
  return e ? { ...defaultBaySettings(), ...e.settings, line: { ...defaultLine(), ...e.settings.line } } : undefined;
}

/* ----------------------- Файл проєкту ----------------------- */

export interface ProjectFile {
  app: 'comtrade-analyzer';
  version: 1;
  savedAt: string;
  records: { id: string; files: string[]; station: string; device: string }[];
  current: number;
  bays: Record<string, BayMap[]>;
  bayIdx: number;
  baySettings: Record<string, BaySettings>;
  filter: FilterOptions;
  units: 'prim' | 'sec';
  tA: number;
  tB: number;
  hodoFromMs: number;
  hodoToMs: number;
  loops: LoopId[];
  directory: DirectoryEntry[];
}

/** Призначення каналів для кожної завантаженої осцилограми (за id). */
export const baysByRecord: Record<string, BayMap[]> = {};

export function exportProject(): ProjectFile {
  const rec = state.records[state.current];
  if (rec) baysByRecord[rec.id] = state.bays;
  return {
    app: 'comtrade-analyzer',
    version: 1,
    savedAt: new Date().toISOString(),
    records: state.records.map((r) => ({ id: r.id, files: r.source.files, station: r.station, device: r.device })),
    current: state.current,
    bays: baysByRecord,
    bayIdx: state.bayIdx,
    baySettings: state.baySettings,
    filter: state.filter,
    units: state.units,
    tA: state.tA,
    tB: state.tB,
    hodoFromMs: state.hodoFromMs,
    hodoToMs: state.hodoToMs,
    loops: state.loops,
    directory: readDirectory(),
  };
}
