import { describe, expect, it } from 'vitest';
import { patchDnsManagement, patchMihomoDnsSettings, readMihomoDnsSettings, renderDns } from './dns-view';

describe('DNS workspaces', () => {
  it('shows DNS status, management, resolver settings and diagnostics together', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('dns-handoff-pane');
    expect(view).toContain('dns-mihomo-pane');
    expect(view).toContain('Проверка DNS');
  });

  it('renders live router DNS status and a guarded transfer control', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('DNS Override');
    expect(view).toContain('Включить управление DNS');
    expect(view).toContain('Передача DNS через Mihomo');
    expect(view).toContain('Статические IPv6 DNS сохраняются и могут обходить Mihomo;');
  });

  it('treats an enabled Mihomo DNS config as separate from router DNS handoff', () => {
    const state = { dnsOverride: false, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Выключено');
    expect(view).toContain('Включить управление DNS');
    expect(view).not.toContain('Состояния DNS не совпадают');
  });

  it('keeps stop-protection active when router override remains but Mihomo DNS is off', () => {
    const state = { dnsOverride: true, mihomoDns: false, portListener: null, nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Нужно проверить');
    expect(view).toContain('Вернуть DNS KeeneticOS');
    expect(view).toContain('Состояния DNS не совпадают');
  });

  it('requires an explicit second step before changing router DNS', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('Статус неизвестен');
    expect(view).toContain('id="dns-management-toggle" type="button" disabled');
  });

  it('explains that Keenetic DNS is restored before Mihomo DNS is disabled', () => {
    const state = { dnsOverride: true, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).toContain('Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.');
  });

  it('shows the DNS handoff prerequisites before enabling', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).toContain('Перед включением отключите XKeen -dns и включите игнорирование DNS провайдера.');
    expect(view).toContain('Включить управление DNS');
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

  it('loads and applies Mihomo resolver settings without changing DNS handoff state', () => {
    const original = 'log-level: info\ndns:\n  enable: false\n  listen: 127.0.0.1:53\n  nameserver:\n    - https://1.1.1.1/dns-query\nproxies: []\n';
    const current = readMihomoDnsSettings(original);
    expect(current.nameserver).toBe('https://1.1.1.1/dns-query');
    const updated = patchMihomoDnsSettings(original, { ...current, enhancedMode: 'fake-ip', nameserver: 'https://8.8.8.8/dns-query' });
    expect(updated).toContain('enable: false');
    expect(updated).toContain('listen: 127.0.0.1:53');
    expect(updated).toContain('enhanced-mode: fake-ip');
    expect(updated).toContain('https://8.8.8.8/dns-query');
    expect(updated).toContain('proxies: []');
  });

  it('rejects malformed nameserver policy YAML before applying it', () => {
    expect(() => patchMihomoDnsSettings('dns: {}\n', { enhancedMode: 'redir-host', bootstrap: '', nameserver: '', nameserverPolicy: '[bad', proxyServerNameserver: '', fallback: '' })).toThrow('Nameserver Policy должен быть YAML-словарём');
    expect(() => patchMihomoDnsSettings('dns: {}\n', { enhancedMode: 'redir-host', bootstrap: '', nameserver: '', nameserverPolicy: 'null', proxyServerNameserver: '', fallback: '' })).toThrow('Nameserver Policy должен быть YAML-словарём');
  });

  it('renders editable Mihomo resolver settings alongside DNS diagnostics', () => {
    const view = renderDns(null, false, null, '', 'A', undefined, {
      values: { enhancedMode: 'redir-host', bootstrap: '77.88.8.8', nameserver: 'https://1.1.1.1/dns-query', nameserverPolicy: '', proxyServerNameserver: '', fallback: '' },
      loading: false, error: null, busy: false,
    });
    expect(view).toContain('id="mihomo-dns-settings"');
    expect(view).toContain('Nameserver Policy');
    expect(view).toContain('Проверка DNS');
  });
});
