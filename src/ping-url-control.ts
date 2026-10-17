const PING_URL_PRESETS = [
  { name: 'Google', url: 'www.gstatic.com/generate_204' },
  { name: 'Cloudflare', url: 'cp.cloudflare.com/generate_204' },
  { name: 'Android', url: 'connectivitycheck.gstatic.com/generate_204' },
  { name: 'Microsoft', url: 'www.msftconnecttest.com/connecttest.txt' },
  { name: 'Apple', url: 'www.apple.com/library/test/success.html' },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function renderPingUrlControl(value: string): string {
  return `<div class="ping-url-field" data-ping-url-control>
    <input class="setting-control setting-url" data-pref="pingUrl" type="text" value="${escapeHtml(value)}" autocomplete="url" spellcheck="false" aria-label="Адрес ping">
    <button class="ping-url-menu-trigger" type="button" aria-label="Выбрать популярный URL ping" aria-haspopup="listbox" aria-expanded="false" aria-controls="ping-url-options"><span aria-hidden="true">⌄</span></button>
    <div class="ping-url-menu" id="ping-url-options" role="listbox" aria-label="Популярные URL ping" hidden>${PING_URL_PRESETS.map(({ name, url }) => `<div class="ping-url-option" role="option" tabindex="-1" aria-selected="${value === url}" data-ping-url="${url}"><span>${name}</span><small>${url}</small></div>`).join('')}</div>
  </div>`;
}

export function bindPingUrlControl(root: HTMLElement): void {
  if (root.dataset.pingUrlDismissBound !== 'true') {
    root.dataset.pingUrlDismissBound = 'true';
    root.addEventListener('click', (event) => {
      const control = root.querySelector<HTMLElement>('[data-ping-url-control]');
      if (control && !control.contains(event.target as Node)) close(control);
    });
  }

  const control = root.querySelector<HTMLElement>('[data-ping-url-control]');
  const input = control?.querySelector<HTMLInputElement>('[data-pref="pingUrl"]');
  const trigger = control?.querySelector<HTMLButtonElement>('.ping-url-menu-trigger');
  const menu = control?.querySelector<HTMLElement>('.ping-url-menu');
  if (!control || !input || !trigger || !menu) return;

  const options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  const syncSelection = () => options.forEach((option) => option.setAttribute('aria-selected', String(option.dataset.pingUrl === input.value)));
  const setOpen = (open: boolean, focus = false) => {
    trigger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (open && focus) (options.find((option) => option.dataset.pingUrl === input.value) ?? options[0])?.focus();
  };
  const choose = (option: HTMLElement) => {
    const value = option.dataset.pingUrl;
    if (!value) return;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    syncSelection();
    setOpen(false);
    trigger.focus();
  };

  input.addEventListener('input', syncSelection);
  input.addEventListener('change', syncSelection);
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

function close(control: HTMLElement): void {
  control.querySelector<HTMLButtonElement>('.ping-url-menu-trigger')?.setAttribute('aria-expanded', 'false');
  const menu = control.querySelector<HTMLElement>('.ping-url-menu');
  if (menu) menu.hidden = true;
}
