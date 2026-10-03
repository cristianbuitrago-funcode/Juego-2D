type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Crea un elemento DOM de forma declarativa (sin frameworks). Los textos se insertan como texto, nunca como HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let toastRoot: HTMLElement | null = null;

/** Notificación flotante. */
export function toast(text: string, level: 'info' | 'warn' | 'error' = 'info', ms = 3500) {
  toastRoot ??= document.getElementById('toasts');
  if (!toastRoot) return;
  // Evitar duplicados seguidos.
  const last = toastRoot.lastElementChild as HTMLElement | null;
  if (last && last.dataset.text === text) {
    last.dataset.count = String(Number(last.dataset.count ?? '1') + 1);
    return;
  }
  const el = h('div', { class: `toast ${level}` }, text);
  el.dataset.text = text;
  toastRoot.append(el);
  while (toastRoot.children.length > 5) toastRoot.firstElementChild?.remove();
  setTimeout(() => el.classList.add('fade'), ms - 400);
  setTimeout(() => el.remove(), ms);
}
