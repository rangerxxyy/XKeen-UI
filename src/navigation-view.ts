export type NavigationPage = { id: string; label: string; icon: string };

export const MAIN_NAVIGATION_PAGES = [
  { id: 'selectors', label: 'Селекторы', icon: '<path d="M3 5h5l3 3h6M3 13h5l3-3h6"/><path d="m14 5 3 3-3 3"/>' },
  { id: 'connections', label: 'Соединения', icon: '<circle cx="5" cy="5" r="2"/><circle cx="15" cy="11" r="2"/><circle cx="5" cy="17" r="2"/><path d="M7 6.2 13.2 9.8M7 15.8l6.2-3.6"/>' },
  { id: 'dns', label: 'DNS', icon: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.5"/><path d="M10 3v2M17 10h-2"/>' },
  { id: 'configuration', label: 'Конфигурация', icon: '<path d="M4 4h12M4 10h12M4 16h12"/><circle cx="8" cy="4" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="16" r="1.5"/>' },
] as const;

export function renderNavigationView(pages: readonly NavigationPage[], activePage: string, configFileTabs = ''): string {
  const configurationPage = activePage === 'configuration';
  const fileTabs = configurationPage ? `<div class="config-file-switcher-panel">${configFileTabs}</div>` : '';
  return `<nav class="navigation" aria-label="Разделы панели">${pages.map((page) => `<button class="nav-item ${activePage === page.id ? 'active' : ''}" data-page="${page.id}" ${activePage === page.id ? 'aria-current="page"' : ''}><span class="nav-icon"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${page.icon}</svg></span><span class="nav-label">${page.label}</span></button>`).join('')}${fileTabs}</nav>`;
}

export function renderWorkspaceFrame(navigation: string, pageContent: string, mainClass = 'main-content'): string {
  return `<section class="workspace-frame">${navigation}<main class="${mainClass}">${pageContent}</main></section>`;
}
