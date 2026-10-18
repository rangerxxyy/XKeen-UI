import { describe, expect, it } from 'vitest';
import { MAIN_NAVIGATION_PAGES, renderNavigationView } from './navigation-view';

describe('main navigation', () => {
  it('keeps config files in a separate outlined row and matches the reference main tab order', () => {
    const configTabs = '<div class="config-file-nav"><button class="config-file-tab selected">config</button><button>ip_exclude</button></div>';
    const configMarkup = renderNavigationView(MAIN_NAVIGATION_PAGES, 'configuration', configTabs);
    const otherPageMarkup = renderNavigationView(MAIN_NAVIGATION_PAGES, 'selectors', configTabs);
    const mainNavigation = configMarkup.slice(0, configMarkup.indexOf('</nav>') + '</nav>'.length);

    expect(MAIN_NAVIGATION_PAGES.map((page) => page.id)).toEqual(['selectors', 'connections', 'dns', 'configuration']);
    expect(configMarkup.indexOf('</nav>')).toBeLessThan(configMarkup.indexOf('class="config-file-switcher-panel"'));
    expect(configMarkup).toContain('<div class="config-file-switcher-panel">');
    expect(mainNavigation).not.toContain('config-file-nav');
    expect(configMarkup.match(/<nav/g)).toHaveLength(1);
    expect(otherPageMarkup).not.toContain('class="config-file-switcher-panel"');
  });
});
