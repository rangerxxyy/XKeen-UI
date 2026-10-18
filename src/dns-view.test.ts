import { describe, expect, it } from 'vitest';
import { patchDnsManagement, patchMihomoDnsSettings, readMihomoDnsSettings, renderDns } from './dns-view';

describe('DNS workspaces', () => {
  it('shows DNS status, management, resolver settings and diagnostics together', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('dns-handoff-pane');
    expect(view).toContain('dns-mihomo-pane');
    expect(view).toContain('DNS Diagnostics');
  });

  it('renders live router DNS status and a guarded transfer control', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('DNS Override');
    expect(view).toContain('Слушатель 53 порта');
    expect(view).not.toContain('DNS-серверы роутера');
    expect(view).toContain('Статус DNS');
    expect(view).toContain('id="dns-management-refresh"');
    expect(view).toContain('Включить управление DNS');
    expect(view).not.toContain('Состояние получено');
    expect(view).toContain('type="checkbox" role="switch"');
    expect(view).not.toContain('DNS-серверы роутера');
    expect(view).not.toContain('Передача DNS через Mihomo');
    expect(view).not.toContain('dns-management-help');
    expect(view).not.toContain('dns-handoff-intro');
    expect(view.indexOf('dns-management-help')).toBe(-1);
  });

  it('treats an enabled Mihomo DNS config as separate from router DNS handoff', () => {
    const state = { dnsOverride: false, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Неактивно');
    expect(view).toContain('Включить управление DNS');
    expect(view).not.toContain('Состояния DNS не совпадают');
  });

  it('keeps stop-protection active when router override remains but Mihomo DNS is off', () => {
    const state = { dnsOverride: true, mihomoDns: false, portListener: null, nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Состояния DNS не совпадают');
    expect(view).toMatch(/id="dns-management-toggle"[^>]*checked/);
    expect(view).toContain('Состояния DNS не совпадают');
  });

  it('requires an explicit second step before changing router DNS', () => {
    const view = renderDns(null, false, null, '', 'A');
    expect(view).toContain('Обновить статус');
    expect(view).toContain('id="dns-management-toggle"');
    expect(view).toMatch(/id="dns-management-toggle"[^>]*type="checkbox"[^>]*role="switch"[^>]*disabled/);
  });

  it('reflects the actual DNS handoff state in the switch and active labels', () => {
    const state = { dnsOverride: true, mihomoDns: true, portListener: 'mihomo', nameServers: [], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toMatch(/id="dns-management-toggle"[^>]*type="checkbox"[^>]*role="switch"[^>]*checked/);
    expect(view).toContain('<strong class="state-pill dns-state-value state-running">Активно</strong>');
    expect(view).toContain('<strong class="state-pill dns-state-value">mihomo</strong>');
    expect(view).not.toContain('Вернуть DNS KeeneticOS');
  });

  it('explains that Keenetic DNS is restored before Mihomo DNS is disabled', () => {
    const state = { dnsOverride: true, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).toContain('Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.');
    expect(view).toMatch(/id="dns-management-toggle"[^>]*checked[^>]*disabled/);
    expect(view).toContain('Подтвердить возврат DNS');
  });

  it('shows the DNS handoff prerequisites before enabling', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).toContain('Перед включением отключите XKeen -dns и включите игнорирование DNS провайдера.');
    expect(view).toContain('<strong>Передача DNS через Mihomo.</strong> IPv4 DNS роутера будет перенаправлен через Mihomo. Статические IPv6 DNS и DoH/DoT не меняются и могут обходить его. Перед остановкой XKeen сначала верните DNS KeeneticOS.');
    expect(view).toContain('Включить управление DNS');
    expect(view).toContain('Передача управления DNS от KeeneticOS к Mihomo');
    expect(view).not.toContain('Enable DNS Management');
    expect(view).not.toContain('Transfer DNS management from KeeneticOS to Mihomo');
  });

  it('does not show the enable warning while confirming a DNS handoff disable', () => {
    const state = { dnsOverride: true, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).not.toContain('Передача DNS через Mihomo. IPv4 DNS роутера');
    expect(view).toContain('Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.');
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

  it('reads fake-ip filter mode from the live YAML and leaves it untouched when saving resolver fields', () => {
    const original = 'dns:\n  enhanced-mode: fake-ip\n  fake-ip-filter-mode: blacklist\n  fake-ip-filter:\n    - "+.lan"\n';
    const current = readMihomoDnsSettings(original);
    expect(current).toMatchObject({ enhancedMode: 'fake-ip', fakeIpFilterMode: 'blacklist' });

    const updated = patchMihomoDnsSettings(original, { ...current, nameserver: '1.1.1.1' });
    expect(updated).toContain('fake-ip-filter-mode: blacklist');
    expect(updated).toContain('"+.lan"');
    expect(readMihomoDnsSettings('dns:\n  enhanced-mode: fake-ip\n').fakeIpFilterMode).toBe('blacklist');
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
    expect(view).toContain('Enhanced Mode');
    expect(view).toContain('Nameserver Policy');
    expect(view).toContain('DNS-серверы, используемые для обычных запросов устройств');
    expect(view).toContain('class="dns-info"');
    expect(view).toContain('реальные IP в ответах');
    expect(view).toContain('поддельные IP в ответах');
    expect(view).toContain('DNS Diagnostics');
  });

  it('keeps DNS help icons beside labels and sizes Nameserver for every configured line', () => {
    const view = renderDns(null, false, null, '', 'A', undefined, {
      values: {
        enhancedMode: 'redir-host',
        bootstrap: '77.88.8.8\ntls://8.8.8.8',
        nameserver: 'quic://one.example\nhttps://two.example/dns-query\nquic://9.9.9.9\nquic://geohide.ru\ntls://1.1.1.1',
        nameserverPolicy: '',
        proxyServerNameserver: '',
        fallback: '',
      },
      loading: false, error: null, busy: false,
    });

    expect(view).toContain('<span class="dns-field-heading"><span>Nameserver</span><span class="dns-info"');
    expect(view).toContain('<textarea name="nameserver" rows="5"');
  });

  it('provides accessible explanations for every DNS status, handoff, resolver, and diagnostic field', () => {
    const state = { dnsOverride: false, mihomoDns: true, portListener: 'mihomo', nameServers: ['192.168.1.1'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', { status: state, loading: false, error: null, busy: false, confirm: false }, {
      values: { enhancedMode: 'redir-host', bootstrap: '', nameserver: '', nameserverPolicy: '', proxyServerNameserver: '', fallback: '' },
      loading: false, error: null, busy: false,
    });
    const explanations = [...view.matchAll(/class="dns-info"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
    for (const label of ['DNS Override', 'DNS Mihomo', 'Слушатель 53 порта', 'Управление DNS', 'Enhanced Mode', 'Default Nameserver', 'Nameserver', 'Nameserver Policy', 'Proxy Server Nameserver', 'Fallback', 'Domain or IP', 'Record Type']) {
      expect(explanations.some((description) => description?.includes(label)), label).toBe(true);
    }
    expect(explanations).toHaveLength(12);
    expect(view.match(/class="dns-info"[^>]*tabindex="0"/g)).toHaveLength(12);
  });

  it('warns when fake-ip is used with a blacklist filter mode', () => {
    const view = renderDns(null, false, null, '', 'A', undefined, {
      values: { enhancedMode: 'fake-ip', fakeIpFilterMode: 'blacklist', bootstrap: '', nameserver: '', nameserverPolicy: '', proxyServerNameserver: '', fallback: '' },
      loading: false, error: null, busy: false,
    });

    expect(view).toContain('dns-fake-ip-warning');
    expect(view).toContain('fake-ip');
    expect(view).toContain('blacklist');
    expect(view).toContain('whitelist');
  });

  it('does not warn when fake-ip filtering uses whitelist or rule mode', () => {
    for (const fakeIpFilterMode of ['whitelist', 'rule']) {
      const view = renderDns(null, false, null, '', 'A', undefined, {
        values: { enhancedMode: 'fake-ip', fakeIpFilterMode, bootstrap: '', nameserver: '', nameserverPolicy: '', proxyServerNameserver: '', fallback: '' },
        loading: false, error: null, busy: false,
      });
      expect(view).not.toContain('dns-fake-ip-warning');
    }
  });
});
