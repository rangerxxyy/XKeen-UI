import { describe, expect, it } from 'vitest';
import { renderDns } from './dns-view';

describe('DNS workspaces', () => {
  it('opens on read-only Mihomo lookup and keeps handoff out of the active view', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('data-dns-panel="mihomo" aria-pressed="true"');
    expect(view).toContain('dns-handoff-pane" hidden');
  });

  it('shows router DNS handoff as off and unavailable until its API is implemented', () => {
    const view = renderDns(null, false, null, '', 'A', 'handoff');
    expect(view).toContain('Передача DNS роутера');
    expect(view).toContain('Выключено');
    expect(view).toContain('DoH/DoT и контентного фильтра');
    expect(view).toContain('Включить</button>');
    expect(view).toContain('Управление отключено');
  });
});
