export type NavigationPage = { id: string; label: string; icon: string };

export const MAIN_NAVIGATION_PAGES = [
  { id: 'selectors', label: 'Селекторы', icon: '⇄' },
  { id: 'connections', label: 'Соединения', icon: '⌁' },
  { id: 'dns', label: 'DNS', icon: '◎' },
  { id: 'configuration', label: 'Конфигурация', icon: '⌘' },
] as const;

export function renderNavigationView(pages: readonly NavigationPage[], activePage: string, configFileTabs = ''): string {
  const configurationPage = activePage === 'configuration';
  const navigation = `<nav class="navigation" aria-label="Разделы панели">${pages.map((page) => `<button class="nav-item ${activePage === page.id ? 'active' : ''}" data-page="${page.id}" ${activePage === page.id ? 'aria-current="page"' : ''}><span class="nav-icon">${page.icon}</span>${page.label}</button>`).join('')}</nav>`;
  return `${navigation}${configurationPage ? `<div class="config-file-switcher-panel">${configFileTabs}</div>` : ''}`;
}
