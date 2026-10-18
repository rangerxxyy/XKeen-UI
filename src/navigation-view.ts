export type NavigationPage = { id: string; label: string; icon: string };

export const MAIN_NAVIGATION_PAGES = [
  { id: 'selectors', label: 'Селекторы', icon: '<path d="M3 5h5l3 3h6M3 13h5l3-3h6"/><path d="m14 5 3 3-3 3"/>' },
  { id: 'connections', label: 'Соединения', icon: '<circle cx="5" cy="5" r="2"/><circle cx="15" cy="11" r="2"/><circle cx="5" cy="17" r="2"/><path d="M7 6.2 13.2 9.8M7 15.8l6.2-3.6"/>' },
  { id: 'configuration', label: 'Конфигурация', icon: '<path d="M4 4h12M4 10h12M4 16h12"/><circle cx="8" cy="4" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="16" r="1.5"/>' },
  { id: 'dns', label: 'DNS', icon: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.5"/><path d="M10 3v2M17 10h-2"/>' },
] as const;

export function renderProviderNavigationActions(): string {
  return `<div class="navigation-actions"><button class="version-chip rulesets-open" id="rulesets-open" type="button" title="Просмотр rule-set Mihomo" aria-label="Рулсеты"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5 8h6M5 10.5h6"/></svg><span>Рулсеты</span></button><button class="version-chip subscriptions-open" id="subscriptions-open" type="button" title="Просмотр подписок Mihomo" aria-label="Подписки"><svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/></svg><span>Подписки</span></button></div>`;
}

export function renderNavigationView(pages: readonly NavigationPage[], activePage: string, configFileTabs = '', rightActions = ''): string {
  const configurationPage = activePage === 'configuration';
  const fileTabs = configurationPage ? `<div class="config-file-switcher-panel">${configFileTabs}</div>` : '';
  const contextualActions = activePage === 'selectors' ? rightActions : '';
  return `<nav class="navigation" aria-label="Разделы панели">${pages.map((page) => `<button class="nav-item ${activePage === page.id ? 'active' : ''}" data-page="${page.id}" ${activePage === page.id ? 'aria-current="page"' : ''}><span class="nav-icon"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${page.icon}</svg></span><span class="nav-label">${page.label}</span></button>`).join('')}<div class="navigation-spacer" aria-hidden="true"></div>${fileTabs}${contextualActions}</nav>`;
}

export function renderWorkspaceFrame(navigation: string, pageContent: string, mainClass = 'main-content', afterFrame = ''): string {
  return `<section class="workspace-frame">${navigation}<main class="${mainClass}">${pageContent}</main></section>${afterFrame}`;
}
