import { describe, expect, it } from 'vitest';
import { MAIN_NAVIGATION_PAGES, renderNavigationView, renderWorkspaceFrame } from './navigation-view';

describe('main navigation', () => {
  it('keeps config files in a framed group at the right of the reference main tab row', () => {
    const configTabs = '<div class="config-file-nav"><button class="config-file-tab selected">config</button><button>ip_exclude</button></div>';
    const configMarkup = renderNavigationView(MAIN_NAVIGATION_PAGES, 'configuration', configTabs);
    const otherPageMarkup = renderNavigationView(MAIN_NAVIGATION_PAGES, 'selectors', configTabs);
    const mainNavigation = configMarkup.slice(0, configMarkup.indexOf('</nav>') + '</nav>'.length);

    expect(MAIN_NAVIGATION_PAGES.map((page) => page.id)).toEqual(['selectors', 'connections', 'dns', 'configuration']);
    expect(mainNavigation).toContain('class="config-file-switcher-panel"');
    expect(mainNavigation.indexOf('data-page="configuration"')).toBeLessThan(mainNavigation.indexOf('class="config-file-switcher-panel"'));
    expect(mainNavigation).toContain('class="config-file-nav"');
    expect(configMarkup.match(/<nav/g)).toHaveLength(1);
    expect(otherPageMarkup).not.toContain('class="config-file-switcher-panel"');
  });

  it('renders four clearly separated icon tabs with an explicit active state', () => {
    const markup = renderNavigationView(MAIN_NAVIGATION_PAGES, 'connections');

    expect(markup.match(/class="nav-item /g)).toHaveLength(4);
    expect(markup).toContain('class="nav-icon"><svg');
    expect(markup).toContain('data-page="connections" aria-current="page"');
    expect(markup).toContain('<span class="nav-label">Соединения</span></button>');
    expect(markup).not.toContain('data-page="proxies"');
  });

  it('places navigation and active content inside one rounded workspace frame', () => {
    const frame = renderWorkspaceFrame(renderNavigationView(MAIN_NAVIGATION_PAGES, 'selectors'), '<div class="selector-list"></div>');

    expect(frame).toMatch(/^<section class="workspace-frame"><nav class="navigation"/);
    expect(frame).toContain('<main class="main-content"><div class="selector-list"></div></main></section>');
  });

  it('keeps the journal after the workspace for every active page, including configuration', () => {
    const frame = renderWorkspaceFrame(
      renderNavigationView(MAIN_NAVIGATION_PAGES, 'configuration'),
      '<section class="config-layout"></section>',
      'main-content',
      '<section class="journal-panel">Журнал</section>',
    );

    expect(frame).toMatch(/<section class="workspace-frame">[\s\S]*<\/section><section class="journal-panel">Журнал<\/section>$/);
  });
});
