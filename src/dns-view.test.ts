import { describe, expect, it } from 'vitest';
import { patchDnsManagement, renderDns } from './dns-view';

describe('DNS workspaces', () => {
  it('opens on read-only Mihomo lookup and keeps handoff out of the active view', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('data-dns-panel="mihomo" aria-pressed="true"');
    expect(view).toContain('dns-handoff-pane" hidden');
  });

  it('renders live router DNS status and a guarded transfer control', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', 'handoff', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('DNS Override');
    expect(view).toContain('Передать DNS Mihomo');
    expect(view).toContain('Перед включением проверьте активную конфигурацию DNS Mihomo');
  });

  it('requires an explicit second step before changing router DNS', () => {
    const view = renderDns(null, false, null, '', 'A', 'handoff');
    expect(view).toContain('Статус неизвестен');
    expect(view).toContain('id="dns-management-toggle" type="button" disabled');
  });

  it('updates Mihomo DNS keys without discarding the rest of the config', () => {
    const original = 'log-level: info\ndns:\n  enable: false\n  nameserver:\n    - 1.1.1.1\nproxies: []\n';
    const updated = patchDnsManagement(original, true);
    expect(updated).toContain('enable: true');
    expect(updated).toContain('listen: 0.0.0.0:53');
    expect(updated).toContain('    - 1.1.1.1');
    expect(updated).toContain('proxies: []');
    expect(patchDnsManagement(updated, false)).toContain('enable: false');
  });
});
