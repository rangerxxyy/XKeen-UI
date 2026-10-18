export const usefulLinks = [
  { title: 'Инструкция XKeen', url: 'https://github.com/Corvus-Malus/XKeen/' },
  { title: 'FAQ XKeen', url: 'https://jameszero.net/faq-xkeen.htm' },
  { title: 'Документация Xray', url: 'https://xtls.github.io/ru/config' },
  { title: 'Документация Mihomo', url: 'https://wiki.metacubex.one/ru/config/general' },
] as const;

export function renderUsefulLinksMenu(): string {
  const links = usefulLinks.map(({ title, url }) =>
    `<a class="utility-link" role="menuitem" href="${url}" target="_blank" rel="noopener noreferrer"><span class="utility-icon" aria-hidden="true">↗</span><span>${title}</span></a>`,
  ).join('');
  return `<details class="editor-utilities-links"><summary role="menuitem"><span class="utility-icon" aria-hidden="true">↗</span><span>Полезные ссылки</span><span class="utilities-chevron" aria-hidden="true"></span></summary><div class="editor-utilities-links-menu" role="menu" aria-label="Полезные ссылки">${links}</div></details>`;
}

export function mountUsefulLinksMenu(root: ParentNode = document): void {
  const menu = root.querySelector<HTMLElement>('.editor-utilities-menu');
  if (!menu || menu.querySelector('.editor-utilities-links')) return;
  menu.insertAdjacentHTML('beforeend', `<div class="editor-utilities-divider" role="separator"></div>${renderUsefulLinksMenu()}`);
}
