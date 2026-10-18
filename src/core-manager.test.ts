import { describe, expect, it } from 'vitest';
import { renderCoreManager } from './core-manager';

describe('renderCoreManager', () => {
  it('shows installed Mihomo and offers a separate update action', () => {
    const html = renderCoreManager({
      mihomo: { installed: true, active: true, version: 'v1.19.32-r4' },
      xray: { installed: false, active: false, version: null },
    });

    expect(html).toContain('Управление ядром');
    expect(html).toContain('Mihomo');
    expect(html).toContain('Активно');
    expect(html).toContain('v1.19.32-r4');
    expect(html).toContain('data-core-action="mihomo"');
    expect(html).toContain('Обновить');
  });

  it('offers installation for cores without a detected version', () => {
    const html = renderCoreManager({
      mihomo: { installed: false, active: false, version: null },
      xray: { installed: false, active: false, version: null },
    });

    expect(html).toContain('Xray');
    expect(html).toContain('Не установлено');
    expect(html).toContain('data-core-action="xray"');
    expect(html).toContain('Установить');
  });

  it('offers update for an installed but stopped core', () => {
    const html = renderCoreManager({
      mihomo: { installed: false, active: false, version: null },
      xray: { installed: true, active: false, version: null },
    });

    expect(html).toContain('Установлено');
    expect(html).toContain('data-core-action="xray"');
    expect(html).toContain('Обновить');
  });
});
