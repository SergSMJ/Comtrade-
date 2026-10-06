import './style.css';
import { loadComtradeFiles } from './comtrade';
import { loadReginaFiles } from './regina';
import { toAnalysisGrid } from './dsp/resample';
import { autoDetectBays } from './analysis/bay';
import { FILTER_LABELS, type FilterMethod } from './dsp/phasor';
import { parseRio } from './analysis/zones';
import { decodeText, extension, type InputFile } from './io/text';
import { fmt } from './model/units';
import { clear, download, h, numberInput, select, toast } from './ui/dom';
import { absFromMs, invalidate, msRel } from './ui/analysis';
import { baysByRecord, exportProject, state, writeDirectory, type ProjectFile } from './ui/state';
import { renderData } from './ui/views/data';
import { renderOsc } from './ui/views/osc';
import { renderVectors } from './ui/views/vectors';
import { renderHodo } from './ui/views/hodo';
import { applyRio, renderSettings } from './ui/views/settings';

const TABS = [
  { id: 'data', label: 'Дані' },
  { id: 'osc', label: 'Осцилограми' },
  { id: 'vectors', label: 'Векторні діаграми' },
  { id: 'hodo', label: 'Годограф опору' },
  { id: 'settings', label: 'Уставки' },
];

let pendingProject: ProjectFile | null = null;

const app = document.getElementById('app')!;

async function readFiles(list: FileList | File[]): Promise<InputFile[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

async function openFiles(list: FileList | File[]): Promise<void> {
  const files = await readFiles(list);
  const json = files.find((f) => extension(f.name) === 'json');
  if (json) applyProject(JSON.parse(decodeText(json.bytes)) as ProjectFile);
  const c = loadComtradeFiles(files);
  const r = loadReginaFiles(files);
  const errors = [...c.errors, ...r.errors];
  const added = [...c.records, ...r.records];
  for (const e of errors) toast(e, 'error');
  if (added.length) {
    // Повторне завантаження того самого запису замінює попередній.
    for (const rec of added) {
      const i = state.records.findIndex((x) => x.id === rec.id);
      if (i >= 0) state.records[i] = rec;
      else state.records.push(rec);
    }
    selectRecord(state.records.indexOf(added[0]));
    toast(`Завантажено записів: ${added.length}`);
  }
  const rio = files.find((f) => extension(f.name) === 'rio');
  if (rio && state.grid) {
    applyRio(parseRio(decodeText(rio.bytes)));
  }
  if (!added.length && !json && !rio && !errors.length) toast('Не знайдено файлів COMTRADE (CFG+DAT) або «Регіна» (ava*.dat + RgSet.dat)', 'error');
  render();
}

function selectRecord(i: number): void {
  const prev = state.records[state.current];
  if (prev && state.grid) baysByRecord[prev.id] = state.bays;
  state.current = i;
  const rec = state.records[i];
  state.grid = toAnalysisGrid(rec);
  state.bays = baysByRecord[rec.id] ?? pendingProject?.bays[rec.id] ?? autoDetectBays(state.grid.rec);
  state.bayIdx = 0;
  const T = 1 / (rec.frequency || 50);
  state.tA = rec.triggerTime + 2 * T;
  state.tB = Math.max(rec.time[0] + T, rec.triggerTime - T);
  if (pendingProject && pendingProject.records[pendingProject.current]?.id === rec.id) {
    state.tA = pendingProject.tA;
    state.tB = pendingProject.tB;
    state.bayIdx = Math.min(pendingProject.bayIdx, Math.max(0, state.bays.length - 1));
  }
  state.selectedAnalog = [];
  const changed = state.grid.rec.digital.map((d, k) => (d.data.some((v) => v !== d.data[0]) ? k : -1)).filter((k) => k >= 0);
  state.selectedDigital = changed.slice(0, 24);
  invalidate();
}

function applyProject(p: ProjectFile): void {
  if (p.app !== 'comtrade-analyzer') {
    toast('Файл JSON не є проєктом цієї програми', 'error');
    return;
  }
  pendingProject = p;
  Object.assign(baysByRecord, p.bays);
  Object.assign(state.baySettings, p.baySettings);
  state.filter = p.filter;
  state.units = p.units;
  state.hodoFromMs = p.hodoFromMs;
  state.hodoToMs = p.hodoToMs;
  state.loops = p.loops;
  if (p.directory?.length) writeDirectory(p.directory);
  toast(`Проєкт від ${p.savedAt.slice(0, 16).replace('T', ' ')} застосовано. Записи: ${p.records.map((r) => r.files[0]).join(', ')}`);
}

function header(): HTMLElement {
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => fileInput.files && openFiles(fileInput.files));
  const rec = state.grid?.rec;
  const controls: (HTMLElement | null)[] = [];
  if (rec) {
    controls.push(
      state.records.length > 1
        ? select(state.records.map((r, i) => ({ value: i, label: r.id })), state.current, (v) => {
            selectRecord(v);
            render();
          }, { title: 'Запис' })
        : h('span', { class: 'rec-name' }, rec.id),
      state.bays.length
        ? select(state.bays.map((b, i) => ({ value: i, label: b.name })), state.bayIdx, (v) => {
            state.bayIdx = v;
            invalidate();
            render();
          }, { title: 'Приєднання' })
        : null,
      select(
        (Object.keys(FILTER_LABELS) as FilterMethod[]).map((m) => ({ value: m, label: FILTER_LABELS[m] })),
        state.filter.method,
        (v) => {
          state.filter = { ...state.filter, method: v };
          invalidate();
          render();
        },
        { title: 'Фільтр обчислення векторів' },
      ),
      state.filter.method === 'mimic'
        ? h('label', { class: 'inline' }, 'τ ', numberInput(state.filter.mimicTauMs ?? 40, (v) => {
            state.filter = { ...state.filter, mimicTauMs: v };
            invalidate();
            render();
          }, { class: 'num' }), ' мс')
        : null,
      h(
        'div',
        { class: 'seg' },
        (['prim', 'sec'] as const).map((u) =>
          h('button', { class: state.units === u ? 'on' : '', onclick: () => {
            state.units = u;
            render();
          } }, u === 'prim' ? 'Первинні' : 'Вторинні'),
        ),
      ),
    );
  }
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, h('b', {}, 'Аналізатор осцилограм'), h('small', {}, 'COMTRADE · «Регіна»')),
    h('button', { class: 'primary', onclick: () => fileInput.click() }, 'Відкрити файли…'),
    fileInput,
    ...controls,
    h('span', { class: 'grow' }),
    rec
      ? h('button', { onclick: () => {
          download(`проєкт_${rec.station || 'осцилограма'}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportProject(), null, 1), 'application/json');
        } }, 'Зберегти проєкт')
      : null,
  );
}

function cursorBar(): HTMLElement | null {
  const rec = state.grid?.rec;
  if (!rec) return null;
  const dt = 1 / state.grid!.fs;
  const step = (which: 'A' | 'B', n: number) => () => {
    if (which === 'A') state.tA += n * dt;
    else state.tB += n * dt;
    render();
  };
  const cur = (which: 'A' | 'B') => {
    const t = which === 'A' ? state.tA : state.tB;
    return h(
      'div',
      { class: `cursor c${which}` },
      h('b', {}, which === 'A' ? 'А' : 'В'),
      h('button', { class: 'mini', title: '−1 період', onclick: step(which, -state.grid!.N) }, '«'),
      h('button', { class: 'mini', title: '−1 відлік', onclick: step(which, -1) }, '‹'),
      numberInput(Number(msRel(t).toFixed(3)), (v) => {
        if (which === 'A') state.tA = absFromMs(v);
        else state.tB = absFromMs(v);
        render();
      }, { class: 'num' }),
      h('button', { class: 'mini', title: '+1 відлік', onclick: step(which, 1) }, '›'),
      h('button', { class: 'mini', title: '+1 період', onclick: step(which, state.grid!.N) }, '»'),
      h('span', {}, 'мс'),
    );
  };
  return h(
    'div',
    { class: 'cursors' },
    cur('A'),
    cur('B'),
    h('span', { class: 'muted' }, `Δt(А−В) = ${fmt((state.tA - state.tB) * 1000, 4)} мс · пуск ${rec.triggerStamp}`),
  );
}

function welcome(): HTMLElement {
  return h(
    'section',
    { class: 'welcome card' },
    h('h1', {}, 'Аналіз аварійних осцилограм'),
    h('p', {}, 'Перетягніть файли у вікно або натисніть «Відкрити файли…». Обробка виконується лише в цьому браузері — файли нікуди не передаються.'),
    h(
      'ul',
      {},
      h('li', {}, 'COMTRADE IEEE C37.111-1991/1999, IEC 60255-24:2013 — пара CFG + DAT (HDR — за наявності).'),
      h('li', {}, '«Регіна» — ava*.dat разом з RgSet.dat.'),
      h('li', {}, 'RIO (OMICRON) — імпорт характеристик зон; JSON — файл проєкту цієї програми.'),
    ),
  );
}

function render(): void {
  const scrollY = window.scrollY;
  clear(app);
  app.append(header());
  if (!state.grid) {
    app.append(welcome());
    return;
  }
  const bar = cursorBar();
  const tabs = h(
    'nav',
    { class: 'tabs' },
    TABS.map((t) => h('button', { class: state.tab === t.id ? 'on' : '', onclick: () => {
      state.tab = t.id;
      render();
    } }, t.label)),
  );
  const body = h('main', { class: 'body' });
  app.append(tabs, bar ?? '', body);
  try {
    switch (state.tab) {
      case 'data':
        renderData(body, render);
        break;
      case 'osc':
        renderOsc(body, render, () => {
          // Курсор змінився кліком: оновлюємо лише панель курсорів.
          const old = app.querySelector('.cursors');
          const nb = cursorBar();
          if (old && nb) old.replaceWith(nb);
        });
        break;
      case 'vectors':
        renderVectors(body, render);
        break;
      case 'hodo':
        renderHodo(body, render);
        break;
      case 'settings':
        renderSettings(body, render);
        break;
    }
  } catch (e) {
    console.error(e);
    body.append(h('p', { class: 'warn' }, `Помилка відображення: ${(e as Error).message}`));
  }
  window.scrollTo(0, scrollY);
}

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drag');
});
window.addEventListener('dragleave', () => document.body.classList.remove('drag'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag');
  if (e.dataTransfer?.files.length) openFiles(e.dataTransfer.files);
});

render();
