type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | number | null | undefined | false | Child[];

/** Мінімальний конструктор DOM-елементів. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style') {
      el.setAttribute('style', String(v));
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function select<T extends string | number>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  attrs: Attrs = {},
): HTMLSelectElement {
  const s = h(
    'select',
    attrs,
    options.map((o) => h('option', { value: String(o.value), selected: o.value === value }, o.label)),
  );
  s.addEventListener('change', () => {
    const o = options[s.selectedIndex];
    if (o) onChange(o.value);
  });
  return s;
}

export function numberInput(value: number, onChange: (v: number) => void, attrs: Attrs = {}): HTMLInputElement {
  const i = h('input', { type: 'number', step: 'any', value: Number.isFinite(value) ? String(value) : '', ...attrs });
  i.addEventListener('change', () => {
    const v = Number(i.value.replace(',', '.'));
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

export function checkbox(label: string, value: boolean, onChange: (v: boolean) => void, attrs: Attrs = {}): HTMLLabelElement {
  const i = h('input', { type: 'checkbox', checked: value });
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'check', ...attrs }, i, label);
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4000);
}

/** Читає CSS-змінну теми (для кольорів графіків). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
