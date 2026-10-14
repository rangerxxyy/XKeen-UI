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
    expect(view).toContain('Передача управления DNS');
    expect(view).toContain('listen: 0.0.0.0:53');
    expect(view).toContain('192.168.1.1');
    expect(view).toContain('IPv4/IPv6, DoH/DoT, DNS-override и контентный фильтр');
    expect(view).toContain('Отключить фильтр Keenetic');
    expect(view).toContain('Включить управление DNS</button>');
    expect(view).toContain('пока не подключена к API роутера');
  });
});
