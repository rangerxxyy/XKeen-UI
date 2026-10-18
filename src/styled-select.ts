/** Progressive enhancement: native controls remain the form/event source of truth. */
export interface StyledSelectOption { label: string; disabled: boolean; hidden: boolean; group: string }

export function readStyledSelectOptions(select: HTMLSelectElement): StyledSelectOption[] {
  return Array.from(select.options, (option) => {
    const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement as HTMLOptGroupElement : null;
    return { label: option.label, disabled: option.disabled || Boolean(group?.disabled), hidden: option.hidden || Boolean(group?.hidden), group: group?.label ?? '' };
  });
}

export function navigateStyledOptions(options: readonly Pick<StyledSelectOption, 'disabled' | 'hidden'>[], current: number, key: string): number {
  const enabled = options.flatMap((option, index) => option.disabled || option.hidden ? [] : [index]);
  if (!enabled.length) return -1;
  if (key === 'Home') return enabled[0]!;
  if (key === 'End') return enabled.at(-1)!;
  const position = enabled.indexOf(current);
  if (position < 0) return key === 'ArrowUp' ? enabled.at(-1)! : enabled[0]!;
  return enabled[(position + (key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length]!;
}

interface Control { select: HTMLSelectElement; trigger: HTMLButtonElement; sync(): void; dispose(): void }
const controls = new Set<Control>();
const enhanced = new WeakMap<HTMLSelectElement, Control>();
let nextId = 0;
let closeActive: (() => void) | undefined;
const attr = (element: Element, name: string, value: string) => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };

function createControl(select: HTMLSelectElement): Control {
  const doc = select.ownerDocument;
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = `${select.className} styled-select-trigger`;
  trigger.id = `styled-select-trigger-${++nextId}`;
  const caption = doc.createElement('span');
  caption.className = 'styled-select-caption';
  const chevron = doc.createElement('span');
  chevron.className = 'styled-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(caption, chevron);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div');
  menu.className = 'styled-select-menu';
  menu.id = `styled-select-options-${nextId}`;
  menu.role = 'listbox';
  menu.hidden = true;
  menu.tabIndex = -1;
  trigger.setAttribute('aria-controls', menu.id);
  menu.setAttribute('aria-labelledby', trigger.id);
  const popover = typeof menu.showPopover === 'function';
  if (popover) menu.setAttribute('popover', 'manual');
  // Modal dialogs make body siblings inert; retain the dialog as the DOM owner.
  (select.closest('dialog') ?? doc.body).append(menu);
  const savedTabIndex = select.getAttribute('tabindex');
  const savedAriaHidden = select.getAttribute('aria-hidden');
  select.classList.add('styled-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(trigger);
  const aborter = new AbortController();
  const signal = aborter.signal;
  let open = false;
  let active = -1;
  let signature = '';
  let options: StyledSelectOption[] = [];
  let items: HTMLElement[] = [];
  let search = '';
  let searchTime = 0;
  let closingAnimation: Animation | undefined;
  const setStyle = (name: string, value: string) => { if (menu.style.getPropertyValue(name) !== value) menu.style.setProperty(name, value); };

  function finishClose() {
    if (popover && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    menu.inert = false;
    menu.removeAttribute('data-closing');
  }
  function cancelClosingAnimation() {
    const animation = closingAnimation;
    closingAnimation = undefined;
    animation?.cancel();
  }
  function close(returnFocus = false) {
    if (!open) return;
    open = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    if (closeActive === close) closeActive = undefined;
    if (returnFocus && trigger.isConnected) trigger.focus();
    // Keep the popover in the top layer until its exit finishes. No timeout can
    // survive a reopen/dispose, and reduced-motion users get immediate closure.
    cancelClosingAnimation();
    if (typeof menu.animate !== 'function' || doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches || !menu.isConnected) {
      finishClose(); return;
    }
    menu.inert = true;
    menu.setAttribute('data-closing', '');
    const animation = menu.animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: `translateY(${menu.dataset.side === 'top' ? '3' : '-3'}px) scale(.98)` },
    ], { duration: 130, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    closingAnimation = animation;
    void animation.finished.then(() => {
      if (closingAnimation !== animation || open) return;
      closingAnimation = undefined;
      finishClose(); animation.cancel();
    }).catch(() => { /* A reopen or disposal deliberately cancels this animation. */ });
  }
  function activate(index: number) {
    active = index;
    items.forEach((item, itemIndex) => item.classList.toggle('is-active', index === itemIndex));
    const item = items[index];
    if (item) { menu.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
    else menu.removeAttribute('aria-activedescendant');
  }
  function position() {
    if (!open) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = doc.documentElement.clientHeight;
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > viewportHeight) { close(); return; }
    const below = viewportHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < Math.min(menu.scrollHeight, 220) && above > below;
    const maxHeight = Math.max(48, Math.min(320, upward ? above : below));
    setStyle('max-height', `${maxHeight}px`);
    const width = Math.min(Math.max(rect.width, 170), viewportWidth - 16);
    setStyle('width', `${width}px`);
    setStyle('left', `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`);
    setStyle('top', `${upward ? Math.max(8, rect.top - Math.min(menu.scrollHeight, maxHeight) - 6) : rect.bottom + 6}px`);
    attr(menu, 'data-side', upward ? 'top' : 'bottom');
  }
  function sync() {
    const label = select.getAttribute('aria-label') || Array.from(select.labels ?? [], (item) => {
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select,button,.styled-select-menu').forEach((control) => control.remove());
      return copy.textContent?.trim() ?? '';
    }).join(' ') || select.name || 'Выбор';
    attr(trigger, 'aria-label', label);
    const labelledBy = select.getAttribute('aria-labelledby');
    if (labelledBy) attr(trigger, 'aria-labelledby', labelledBy);
    else trigger.removeAttribute('aria-labelledby');
    const describedBy = select.getAttribute('aria-describedby');
    if (describedBy) attr(trigger, 'aria-describedby', describedBy);
    else trigger.removeAttribute('aria-describedby');
    if (trigger.disabled !== select.matches(':disabled')) trigger.disabled = select.matches(':disabled');
    if (trigger.hidden !== select.hidden) trigger.hidden = select.hidden;
    if (trigger.disabled || trigger.hidden) close();
    options = readStyledSelectOptions(select);
    const newSignature = JSON.stringify(options);
    if (newSignature !== signature) {
      signature = newSignature;
      menu.replaceChildren();
      let lastGroup = '';
      items = options.map((option, index) => {
        if (option.group && option.group !== lastGroup && !option.hidden) {
          const heading = doc.createElement('div'); heading.className = 'styled-select-group'; heading.textContent = option.group; heading.role = 'presentation'; menu.append(heading);
        }
        if (!option.hidden) lastGroup = option.group;
        const item = doc.createElement('div');
        item.className = 'styled-select-option'; item.role = 'option'; item.id = `${menu.id}-${index}`; item.dataset.index = String(index);
        item.textContent = option.label; item.hidden = option.hidden; item.setAttribute('aria-disabled', String(option.disabled));
        menu.append(item); return item;
      });
    }
    const text = select.selectedOptions[0]?.label ?? '—';
    if (caption.textContent !== text) caption.textContent = text;
    items.forEach((item, index) => attr(item, 'aria-selected', String(index === select.selectedIndex)));
    if (open) { if (!options[active] || options[active]?.disabled || options[active]?.hidden) activate(navigateStyledOptions(options, select.selectedIndex, 'ArrowDown')); position(); }
  }
  function show(key?: string) {
    sync();
    if (trigger.disabled || !options.some((option) => !option.disabled && !option.hidden)) return;
    closeActive?.(); closeActive = close;
    cancelClosingAnimation();
    menu.inert = false;
    menu.removeAttribute('data-closing');
    menu.hidden = false;
    if (popover && !menu.matches(':popover-open')) menu.showPopover();
    open = true;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    const selected = select.selectedIndex;
    activate(key === 'Home' || key === 'End' ? navigateStyledOptions(options, selected, key) : selected >= 0 && !options[selected]?.disabled && !options[selected]?.hidden ? selected : navigateStyledOptions(options, -1, key ?? 'ArrowDown'));
    menu.focus({ preventScroll: true });
  }
  function choose(index: number) {
    if (!options[index] || options[index]?.disabled || options[index]?.hidden) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close(true);
    sync();
    if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab' && open) close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); if (!open) show(event.key); else activate(navigateStyledOptions(options, active, event.key));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (open) choose(active); else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!open) show();
      const now = Date.now(); search = now - searchTime < 700 ? search + event.key : event.key; searchTime = now;
      const query = search.toLocaleLowerCase();
      for (let offset = 1; offset <= options.length; offset++) {
        const index = (Math.max(active, 0) + offset) % options.length;
        const option = options[index]!;
        if (!option.disabled && !option.hidden && option.label.toLocaleLowerCase().startsWith(query)) { activate(index); break; }
      }
    }
  }
  trigger.addEventListener('click', () => open ? close(true) : show(), { signal });
  trigger.addEventListener('keydown', keyboard, { signal });
  menu.addEventListener('keydown', keyboard, { signal });
  menu.addEventListener('click', (event) => {
    if (!open) return;
    const item = (event.target as Element).closest<HTMLElement>('.styled-select-option'); if (item) choose(Number(item.dataset.index));
  }, { signal });
  doc.addEventListener('pointerdown', (event) => { if (open && !menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); }, { capture: true, signal });
  doc.addEventListener('focusin', (event) => { if (open && !menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); }, { signal });
  doc.addEventListener('scroll', position, { capture: true, passive: true, signal });
  doc.defaultView?.addEventListener('resize', position, { signal });
  select.addEventListener('change', sync, { signal });
  select.addEventListener('focus', () => trigger.focus(), { signal });
  select.addEventListener('invalid', () => trigger.focus(), { signal });
  for (const label of Array.from(select.labels ?? [])) label.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (trigger.contains(target) || target.closest('button,input,textarea,a')) return;
    event.preventDefault(); trigger.focus(); show();
  }, { signal });
  select.form?.addEventListener('reset', () => queueMicrotask(sync), { signal });
  const control: Control = { select, trigger, sync, dispose() {
    open = false; if (closeActive === close) closeActive = undefined;
    cancelClosingAnimation(); finishClose(); aborter.abort(); menu.remove(); trigger.remove(); select.classList.remove('styled-select-native');
    if (savedTabIndex === null) select.removeAttribute('tabindex'); else select.setAttribute('tabindex', savedTabIndex);
    if (savedAriaHidden === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', savedAriaHidden);
    controls.delete(control); enhanced.delete(select);
  } };
  sync(); return control;
}

/** Call after rendering HTML, including content rendered in body-mounted dialogs. */
export function enhanceStyledSelects(root: Document | Element = document): void {
  const selects = [...root.querySelectorAll<HTMLSelectElement>('select')];
  if (root instanceof HTMLSelectElement) selects.unshift(root);
  for (const select of selects) {
    if (enhanced.has(select) || select.multiple || select.size > 1 || select.matches('.selector-sort-native, [aria-hidden="true"], [data-styled-select="off"]') || select.closest('[data-selector-sort], [data-ping-url-control]')) continue;
    const control = createControl(select); enhanced.set(select, control); controls.add(control);
  }
  syncStyledSelects(root);
}

/** Explicitly sync after assigning select.value/options/disabled, and remove detached menus. */
export function syncStyledSelects(root: Document | Element = document): void {
  for (const control of controls) {
    if (!control.select.isConnected || !control.trigger.isConnected) control.dispose();
    else if (root === control.select || root.contains(control.select)) control.sync();
  }
}

export function disposeStyledSelects(root: Document | Element = document): void {
  for (const control of controls) if (root === control.select || root.contains(control.select)) control.dispose();
}
