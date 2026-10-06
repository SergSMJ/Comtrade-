/** Вкладка «Уставки»: параметри лінії, компенсація k0, зони ДЗ, імпорт RIO, довідник приєднань. */
import { parseRio, type RioImport, TEMPLATE_LABELS, TEMPLATE_PARAMS, type TemplateId, type ZoneSpec } from '../../analysis/zones';
import { fmt } from '../../model/units';
import { checkbox, h, numberInput, select, toast } from '../dom';
import { invalidate } from '../analysis';
import { compensationOf, currentBay, currentRecord, currentSettings, readDirectory, saveToDirectory, settingsKey, state, writeDirectory, defaultBaySettings } from '../state';
import { decodeText } from '../../io/text';

export function renderSettings(root: HTMLElement, rerender: () => void): void {
  const bay = currentBay();
  if (!bay) {
    root.append(h('p', { class: 'muted pad' }, 'Спочатку визначте приєднання на вкладці «Дані».'));
    return;
  }
  const s = currentSettings();
  const l = s.line;
  const rec = currentRecord()!;
  const key = settingsKey(rec, bay);

  const field = (label: string, value: number, set: (v: number) => void, unit = '') =>
    h('label', { class: 'field' }, h('span', {}, label), numberInput(value, (v) => {
      set(v);
      invalidate();
      rerender();
    }), unit ? h('small', {}, unit) : null);

  const comp = compensationOf(l);
  const line = h(
    'section',
    { class: 'card' },
    h('h2', {}, `Параметри лінії · ${bay.name}`),
    h(
      'div',
      { class: 'fields' },
      field('R1', l.r1, (v) => (l.r1 = v), 'Ом/км'),
      field('X1', l.x1, (v) => (l.x1 = v), 'Ом/км'),
      field('R0', l.r0, (v) => (l.r0 = v), 'Ом/км'),
      field('X0', l.x0, (v) => (l.x0 = v), 'Ом/км'),
      field('Довжина', l.lengthKm, (v) => (l.lengthKm = v), 'км'),
    ),
    h('p', { class: 'muted' }, `Z1 лінії = ${fmt(l.r1 * l.lengthKm, 4)} + j${fmt(l.x1 * l.lengthKm, 4)} Ом перв., кут ${fmt((Math.atan2(l.x1, l.r1) * 180) / Math.PI, 4)}°. Параметри первинні.`),
    h('h3', {}, 'Компенсація струму землі (петлі ф-з)'),
    h(
      'div',
      { class: 'row' },
      select(
        [
          { value: 'line', label: 'k0 з параметрів лінії: (Z0−Z1)/(3·Z1)' },
          { value: 'k0', label: 'k0 вручну: |k0| ∠φ' },
          { value: 'rexe', label: 'RE/RL, XE/XL (Siemens)' },
        ],
        l.compMode,
        (v) => {
          l.compMode = v as typeof l.compMode;
          rerender();
        },
      ),
    ),
    l.compMode === 'k0' ? h('div', { class: 'fields' }, field('|k0|', l.k0Mag, (v) => (l.k0Mag = v)), field('∠k0', l.k0Ang, (v) => (l.k0Ang = v), '°')) : null,
    l.compMode === 'rexe' ? h('div', { class: 'fields' }, field('RE/RL', l.rerl, (v) => (l.rerl = v)), field('XE/XL', l.xexl, (v) => (l.xexl = v))) : null,
    h('p', { class: 'muted' }, comp.mode === 'k0' ? `Діючий k0 = ${fmt(Math.hypot(comp.k0.re, comp.k0.im), 4)} ∠ ${fmt((Math.atan2(comp.k0.im, comp.k0.re) * 180) / Math.PI, 4)}°` : `Діючі RE/RL = ${fmt(comp.rerl, 4)}, XE/XL = ${fmt(comp.xexl, 4)}`),
    h('h3', {}, 'Взаємоіндукція паралельної лінії'),
    h(
      'div',
      { class: 'row' },
      checkbox('враховувати', l.useMutual, (v) => {
        l.useMutual = v;
        invalidate();
        rerender();
      }),
      h('label', {}, '3I0 паралельної лінії: ', select(
        [{ value: -1, label: '— не обрано —' }, ...rec.analog.map((c, i) => ({ value: i, label: `${c.index}. ${c.name}` }))],
        l.parallelIn ?? -1,
        (v) => {
          l.parallelIn = v < 0 ? null : v;
          invalidate();
          rerender();
        },
      )),
    ),
    h('div', { class: 'fields' }, field('R0m', l.r0m, (v) => (l.r0m = v), 'Ом/км'), field('X0m', l.x0m, (v) => (l.x0m = v), 'Ом/км')),
  );

  const zones = h('section', { class: 'card' }, h('h2', {}, 'Зони дистанційного захисту'));
  const addRow = h(
    'div',
    { class: 'row' },
    select(
      (Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((t) => ({ value: t, label: TEMPLATE_LABELS[t] })),
      'generic-quad' as TemplateId,
      () => undefined,
      { id: 'tpl-select' },
    ),
    h('button', { onclick: () => {
      const sel = document.getElementById('tpl-select') as HTMLSelectElement;
      const tpl = sel.value as TemplateId;
      const params: Record<string, number> = {};
      for (const p of TEMPLATE_PARAMS[tpl]) params[p.key] = p.def;
      s.zones.push({
        id: `z${Date.now().toString(36)}`,
        name: `Z${s.zones.length + 1}`,
        template: tpl,
        params,
        direction: 'forward',
        families: ['pp', 'pe'],
        units: state.units,
        enabled: true,
      });
      rerender();
    } }, 'Додати зону'),
    h('label', { class: 'button' }, 'Імпорт RIO…', rioInput(rerender)),
    s.rioZones.length ? h('button', { onclick: () => {
      s.rioZones = [];
      rerender();
    } }, `Видалити зони RIO (${s.rioZones.length})`) : null,
  );
  zones.append(addRow, ...s.zones.map((z, i) => zoneEditor(z, i, rerender)));
  if (s.rioZones.length) {
    zones.append(
      h('h3', {}, 'Зони з RIO'),
      h(
        'div',
        { class: 'row wrap' },
        s.rioZones.map((z) =>
          checkbox(`${z.name} (${z.family === 'pp' ? 'ф-ф' : 'ф-з'})${z.timeS !== undefined ? `, ${z.timeS} с` : ''}`, z.enabled, (v) => {
            z.enabled = v;
            rerender();
          }),
        ),
      ),
      h('p', { class: 'muted' }, 'Полігони RIO задано у вторинних Омах (RATING файлу) у площині «на фазу».'),
    );
  }

  const dir = readDirectory();
  const directory = h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Довідник приєднань (зберігається в цьому браузері)'),
    h('div', { class: 'row' },
      h('button', { onclick: () => {
        toast(saveToDirectory(key, s) ? `Збережено: ${bay.name}` : 'Сховище браузера недоступне', 'info');
        rerender();
      } }, 'Зберегти уставки приєднання в довідник'),
      h('button', { onclick: () => {
        state.baySettings[key] = defaultBaySettings();
        rerender();
      } }, 'Скинути до типових'),
    ),
    dir.length
      ? h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, ['Об’єкт', 'Приєднання', 'Збережено', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, dir.map((e) => h('tr', {},
            h('td', {}, e.station), h('td', {}, e.bay), h('td', {}, e.savedAt.slice(0, 16).replace('T', ' ')),
            h('td', {},
              h('button', { class: 'link', onclick: () => {
                state.baySettings[key] = JSON.parse(JSON.stringify(e.settings));
                invalidate();
                toast(`Застосовано уставки «${e.bay}» до «${bay.name}»`);
                rerender();
              } }, 'застосувати'),
              ' ',
              h('button', { class: 'link danger', onclick: () => {
                writeDirectory(readDirectory().filter((x) => x.key !== e.key));
                rerender();
              } }, 'видалити'),
            ),
          ))),
        )
      : h('p', { class: 'muted' }, 'Довідник порожній. Для обміну з колегами використовуйте «Зберегти проєкт» (JSON містить і довідник).'),
  );

  root.append(h('div', { class: 'cols' }, h('div', {}, line, directory), h('div', {}, zones)));
}

function rioInput(rerender: () => void): HTMLInputElement {
  const input = h('input', { type: 'file', accept: '.rio,.RIO', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const text = decodeText(new Uint8Array(await f.arrayBuffer()));
    applyRio(parseRio(text));
    rerender();
  });
  return input;
}

function zoneEditor(z: ZoneSpec, i: number, rerender: () => void): HTMLElement {
  const s = currentSettings();
  const name = h('input', { type: 'text', value: z.name, class: 'short' });
  name.addEventListener('change', () => {
    z.name = name.value;
    rerender();
  });
  const fams = (['pp', 'pe'] as const).map((f) =>
    checkbox(f === 'pp' ? 'ф-ф' : 'ф-з', z.families.includes(f), (v) => {
      z.families = v ? [...new Set([...z.families, f])] : z.families.filter((x) => x !== f);
      rerender();
    }),
  );
  return h(
    'div',
    { class: 'zone' },
    h(
      'div',
      { class: 'row' },
      checkbox('', z.enabled, (v) => {
        z.enabled = v;
        rerender();
      }),
      name,
      h('b', {}, TEMPLATE_LABELS[z.template]),
      select(
        [
          { value: 'forward', label: 'вперед' },
          { value: 'reverse', label: 'назад' },
          { value: 'non', label: 'ненапрямлена' },
        ],
        z.direction,
        (v) => {
          z.direction = v as ZoneSpec['direction'];
          rerender();
        },
      ),
      ...fams,
      select(
        [
          { value: 'prim', label: 'Ом перв.' },
          { value: 'sec', label: 'Ом втор.' },
        ],
        z.units,
        (v) => {
          z.units = v as ZoneSpec['units'];
          rerender();
        },
      ),
      h('label', {}, 't = ', numberInput(z.timeS ?? NaN, (v) => {
        z.timeS = v;
        rerender();
      }, { class: 'num' }), ' с'),
      h('button', { class: 'link danger', onclick: () => {
        s.zones.splice(i, 1);
        rerender();
      } }, 'видалити'),
    ),
    h(
      'div',
      { class: 'fields' },
      TEMPLATE_PARAMS[z.template].map((p) =>
        h(
          'label',
          { class: 'field', title: p.note ?? '' },
          h('span', {}, p.label, p.note ? ' *' : ''),
          numberInput(z.params[p.key] ?? p.def, (v) => {
            z.params[p.key] = v;
            rerender();
          }),
          h('small', {}, p.unit),
        ),
      ),
    ),
    TEMPLATE_PARAMS[z.template].some((p) => p.note)
      ? h('p', { class: 'muted' }, '* ', [...new Set(TEMPLATE_PARAMS[z.template].filter((p) => p.note).map((p) => p.note))].join('; '))
      : null,
    z.template === 'rel670' ? h('p', { class: 'muted' }, 'Ф-з: характеристику ZMQPDIS задано в петлевій площині (X = (2X1+X0)/3, R = (2R1+R0)/3 + RFPE) і переведено в площину прямої послідовності діленням на (1+k0). Ф-ф: X1, R = RFPP/2.') : null,
  );
}

/** Застосування RIO до поточного приєднання: зони + коефіцієнти RE/RL, XE/XL (якщо задані). */
export function applyRio(res: RioImport): void {
  const s = currentSettings();
  s.rioZones = res.zones;
  if (res.rerl !== undefined && res.xexl !== undefined) {
    s.line.rerl = res.rerl;
    s.line.xexl = res.xexl;
    s.line.compMode = 'rexe';
  }
  invalidate();
  toast(`RIO «${res.device}»: зон ${new Set(res.zones.map((z) => z.name)).size}${res.rerl !== undefined ? `; компенсація RE/RL = ${res.rerl}, XE/XL = ${res.xexl}` : ''}`);
  res.warnings.forEach((w) => toast(w, 'error'));
}
