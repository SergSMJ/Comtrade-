/** Вкладка «Дані»: відомості про запис, призначення каналів приєднань, перелік каналів. */
import { autoDetectBays, bayRatios, emptyBay, SLOTS, type PhaseSlot } from '../../analysis/bay';
import { samplingRate } from '../../model/record';
import { fmt } from '../../model/units';
import { checkbox, h, select } from '../dom';
import { invalidate } from '../analysis';
import { currentBay, state } from '../state';

const SLOT_LABEL: Record<'i' | 'u', Record<PhaseSlot, string>> = {
  i: { a: 'Ia', b: 'Ib', c: 'Ic', n: '3I0' },
  u: { a: 'Ua', b: 'Ub', c: 'Uc', n: '3U0' },
};

export function renderData(root: HTMLElement, rerender: () => void): void {
  const grid = state.grid;
  if (!grid) return;
  const rec = grid.rec;
  const orig = state.records[state.current];

  const info = h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Відомості про запис'),
    h(
      'dl',
      { class: 'kv' },
      kv('Об’єкт', rec.station || '—'),
      kv('Пристрій', rec.device || '—'),
      kv('Формат', `${rec.source.format} ${rec.source.revision}`),
      kv('Файли', rec.source.files.join(', ')),
      kv('Початок запису', rec.startStamp || '—'),
      kv('Пуск', rec.triggerStamp || '—'),
      kv('Частота мережі', `${rec.frequency} Гц`),
      kv('Дискретизація', `${fmt(samplingRate(orig), 5)} Гц${grid.resampled ? ` → ${grid.fs} Гц` : ''}, ${grid.N} відліків на період`),
      kv('Тривалість', `${fmt((rec.time[rec.time.length - 1] - rec.time[0]) * 1000, 5)} мс; передісторія ${fmt(rec.triggerTime * 1000, 4)} мс`),
      kv('Канали', `${rec.analog.length} аналогових, ${rec.digital.length} дискретних`),
    ),
    rec.source.notes.length ? h('ul', { class: 'notes' }, rec.source.notes.map((n) => h('li', {}, n))) : null,
    rec.reference ? referenceBlock() : null,
  );

  const bay = currentBay();
  const bayCard = h('section', { class: 'card' }, h('h2', {}, 'Приєднання та призначення каналів'));
  const toolbar = h(
    'div',
    { class: 'row' },
    state.bays.length
      ? select(
          state.bays.map((b, i) => ({ value: i, label: b.name })),
          state.bayIdx,
          (v) => {
            state.bayIdx = v;
            invalidate();
            rerender();
          },
        )
      : h('span', { class: 'muted' }, 'Приєднань не знайдено — додайте вручну.'),
    h('button', { onclick: () => {
      state.bays = autoDetectBays(rec);
      state.bayIdx = 0;
      invalidate();
      rerender();
    } }, 'Автопідбір'),
    h('button', { onclick: () => {
      state.bays.push(emptyBay(`Приєднання ${state.bays.length + 1}`));
      state.bayIdx = state.bays.length - 1;
      invalidate();
      rerender();
    } }, 'Додати'),
    bay
      ? h('button', { class: 'danger', onclick: () => {
          state.bays.splice(state.bayIdx, 1);
          state.bayIdx = 0;
          invalidate();
          rerender();
        } }, 'Видалити')
      : null,
  );
  bayCard.append(toolbar);

  if (bay) {
    const name = h('input', { type: 'text', value: bay.name });
    name.addEventListener('change', () => {
      bay.name = name.value.trim() || bay.name;
      rerender();
    });
    const opts = (kind: 'U' | 'I') => [
      { value: -1, label: '— не призначено —' },
      ...rec.analog.map((c, i) => ({ value: i, label: `${c.index}. ${c.name}${c.kind !== kind ? ' ⚠' : ''}` })),
    ];
    const rows = (['i', 'u'] as const).flatMap((set) =>
      SLOTS.map((slot) => {
        const idx = bay[set][slot];
        return h(
          'tr',
          {},
          h('th', {}, SLOT_LABEL[set][slot]),
          h(
            'td',
            {},
            select(opts(set === 'i' ? 'I' : 'U'), idx ?? -1, (v) => {
              bay[set][slot] = v < 0 ? null : v;
              invalidate();
              rerender();
            }),
          ),
          h(
            'td',
            {},
            idx !== null
              ? checkbox('інверсія', bay.invert.includes(idx), (on) => {
                  bay.invert = on ? [...bay.invert, idx] : bay.invert.filter((x) => x !== idx);
                  invalidate();
                  rerender();
                })
              : slot === 'n'
                ? h('span', { class: 'muted' }, 'обчислюється як сума фаз')
                : null,
          ),
        );
      }),
    );
    const r = bayRatios(rec, bay);
    bayCard.append(
      h('div', { class: 'row' }, h('label', {}, 'Назва: ', name), h('span', { class: 'muted' }, `КТС ${r.ctText}; КТН ${r.vtText}`)),
      h('table', { class: 'grid compact' }, h('tbody', {}, rows)),
      h('p', { class: 'muted' }, 'Позначка ⚠ — тип каналу (U/I) не відповідає позиції. Призначення зберігаються у файлі проєкту.'),
    );
  }

  const chList = h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Аналогові канали'),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'grid compact' },
        h('thead', {}, h('tr', {}, ['№', 'Назва', 'Тип', 'Коло', 'Первинна/вторинна'].map((t) => h('th', {}, t)))),
        h(
          'tbody',
          {},
          rec.analog.map((c) =>
            h('tr', {}, h('td', {}, c.index), h('td', {}, c.name), h('td', {}, c.kind === 'other' ? c.unit : c.kind), h('td', {}, c.circuit), h('td', {}, `${c.primary} / ${c.secondary}`)),
          ),
        ),
      ),
    ),
  );

  root.append(h('div', { class: 'cols' }, h('div', {}, info, chList), h('div', {}, bayCard)));
}

function kv(k: string, v: string) {
  return [h('dt', {}, k), h('dd', {}, v)];
}

function referenceBlock() {
  const ref = state.grid!.rec.reference!;
  return h(
    'div',
    { class: 'ref' },
    h('h3', {}, 'Дані HDR термінала (довідково, для звірки)'),
    h(
      'dl',
      { class: 'kv' },
      kv('Пристрій', ref.device ?? '—'),
      ref.lineLength !== undefined ? kv('Довжина лінії (уставка)', `${fmt(ref.lineLength, 4)} км`) : null,
      ref.faultDistance !== undefined ? kv('ОМП термінала', `${fmt(ref.faultDistance, 4)} (одиниці уставки термінала), петля ${ref.faultLoop ?? '—'}`) : null,
      kv('Подій у журналі', String(ref.events.length)),
    ),
  );
}
