import type { SelectorSort } from './preferences';

const SORT_OPTIONS: { value: SelectorSort; label: string }[] = [
  { value: 'config', label: 'По умолчанию' },
  { value: 'name', label: 'По названию' },
  { value: 'delay', label: 'По пингу' },
];

export function renderSelectorSortControl(selected: SelectorSort): string {
  const current = SORT_OPTIONS.find((option) => option.value === selected) ?? SORT_OPTIONS[0]!;
  return `<div class="selector-sort-dropdown" data-selector-sort>
    <select class="setting-control selector-sort-native" data-pref="selectorSort" tabindex="-1" aria-hidden="true">${SORT_OPTIONS.map(({ value, label }) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <button class="setting-control selector-sort-trigger" type="button" aria-label="Сортировка подключений" aria-haspopup="listbox" aria-expanded="false" aria-controls="selector-sort-options"><span>${current.label}</span><span class="selector-sort-chevron" aria-hidden="true"></span></button>
    <div class="selector-sort-menu" id="selector-sort-options" role="listbox" aria-label="Сортировка подключений" hidden>${SORT_OPTIONS.map(({ value, label }) => `<div class="selector-sort-option" role="option" tabindex="-1" aria-selected="${selected === value}" data-sort-value="${value}">${label}</div>`).join('')}</div>
  </div>`;
}

export function bindSelectorSortControl(root: HTMLElement): void {
  if (root.dataset.sortDismissBound !== 'true') {
    root.dataset.sortDismissBound = 'true';
    root.addEventListener('click', (event) => {
      const wrapper = root.querySelector<HTMLElement>('[data-selector-sort]');
      if (wrapper && !wrapper.contains(event.target as Node)) close(wrapper);
    });
  }

  const wrapper = root.querySelector<HTMLElement>('[data-selector-sort]');
  const nativeSelect = wrapper?.querySelector<HTMLSelectElement>('[data-pref="selectorSort"]');
  const trigger = wrapper?.querySelector<HTMLButtonElement>('.selector-sort-trigger');
  const menu = wrapper?.querySelector<HTMLElement>('.selector-sort-menu');
  if (!wrapper || !nativeSelect || !trigger || !menu) return;

  const options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  const selectedIndex = () => Math.max(0, options.findIndex((option) => option.dataset.sortValue === nativeSelect.value));
  const setOpen = (open: boolean, focus = false) => {
    trigger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (open && focus) options[selectedIndex()]?.focus();
  };
  const choose = (option: HTMLElement) => {
    const value = option.dataset.sortValue;
    if (!value || nativeSelect.value === value) {
      setOpen(false);
      trigger.focus();
      return;
    }
    nativeSelect.value = value;
    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    trigger.querySelector('span')!.textContent = option.textContent ?? '';
    options.forEach((item) => item.setAttribute('aria-selected', String(item === option)));
    setOpen(false);
    trigger.focus();
  };

  trigger.addEventListener('click', () => setOpen(menu.hidden, !menu.hidden));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true, true);
      if (event.key === 'ArrowUp') options.at(-1)?.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (option) choose(option);
  });
  menu.addEventListener('keydown', (event) => {
    const activeIndex = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  });
}

function close(wrapper: HTMLElement): void {
  wrapper.querySelector<HTMLButtonElement>('.selector-sort-trigger')?.setAttribute('aria-expanded', 'false');
  const menu = wrapper.querySelector<HTMLElement>('.selector-sort-menu');
  if (menu) menu.hidden = true;
}
