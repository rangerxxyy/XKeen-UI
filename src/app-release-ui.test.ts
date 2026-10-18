import { describe, expect, it } from 'vitest';
import { renderAppReleaseActions, renderAppUpdateNotice, renderAppVersionChip } from './app-release-ui';

describe('XKeen UI release controls', () => {
  it('uses a compact version-only chip with an accessible update label', () => {
    const html = renderAppVersionChip('0.4.3');
    expect(html).toContain('aria-label="Обновить XKeen UI, версия v0.4.3"');
    expect(html).toContain('>v0.4.3</b>');
    expect(html).not.toContain('Открыть релиз');
  });

  it('escapes version text before placing it in the chip markup', () => {
    const html = renderAppVersionChip('1.2.3"><img src=x>');
    expect(html).toContain('aria-label="Обновить XKeen UI, версия v1.2.3&quot;&gt;&lt;img src=x&gt;"');
    expect(html).toContain('>v1.2.3&quot;&gt;&lt;img src=x&gt;</b>');
    expect(html).not.toContain('<img');
  });

  it('highlights the version chip and shows the available version in a dismissible notice', () => {
    const html = renderAppVersionChip('0.4.5', true);
    expect(html).toContain('app-version-button is-update-available');
    expect(html).toContain('Доступно обновление XKeen UI 0.4.5');

    const notice = renderAppUpdateNotice('v0.4.5', 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.4.5');
    expect(notice).toContain('Доступно обновление');
    expect(notice).toContain('Доступна новая версия XKeen UI v0.4.5');
    expect(notice).toContain('data-open-app-update');
    expect(notice).toContain('data-dismiss-app-update');
    expect(notice).toContain('https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.4.5');
  });

  it('keeps the installer action and omits the external release link', () => {
    const html = renderAppReleaseActions();
    expect(html).toContain('id="app-release-install"');
    expect(html).toContain('Установить');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('app-release-link');
    expect(html).not.toContain('Открыть релиз');
  });
});
