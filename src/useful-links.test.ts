import { describe, expect, it } from 'vitest';
import { renderUsefulLinksMenu, usefulLinks } from './useful-links';

describe('configuration useful links', () => {
  it('matches the four documentation links in upstream utilities', () => {
    expect(usefulLinks).toEqual([
      { title: 'Инструкция XKeen', url: 'https://github.com/Corvus-Malus/XKeen/' },
      { title: 'FAQ XKeen', url: 'https://jameszero.net/faq-xkeen.htm' },
      { title: 'Документация Xray', url: 'https://xtls.github.io/ru/config' },
      { title: 'Документация Mihomo', url: 'https://wiki.metacubex.one/ru/config/general' },
    ]);
  });

  it('renders accessible external links with safe new-tab behavior', () => {
    const html = renderUsefulLinksMenu();
    expect(html).toContain('aria-label="Полезные ссылки"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Инструкция XKeen');
    expect(html).toContain('FAQ XKeen');
    expect(html).toContain('Документация Xray');
    expect(html).toContain('Документация Mihomo');
  });
});
