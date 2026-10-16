type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) el.append(child);
  return el;
}

export function select<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
  className = '',
): HTMLSelectElement {
  const el = h('select', { className });
  for (const option of options)
    el.append(h('option', { value: option.value, textContent: option.label }));
  el.value = value;
  el.onchange = () => onChange(el.value as T);
  return el;
}
