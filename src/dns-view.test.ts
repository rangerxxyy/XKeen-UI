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
    expect(view).toContain('Включить управление DNS');
    expect(view).toContain('Перед включением проверьте активную конфигурацию DNS Mihomo');
    expect(view).toContain('Список IPv6 DNS сохраняется и может обходить Mihomo.');
  });

  it('treats an enabled Mihomo DNS config as separate from router DNS handoff', () => {
    const state = { dnsOverride: false, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', 'handoff', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Выключено');
    expect(view).toContain('Включить управление DNS');
    expect(view).not.toContain('Состояния DNS не совпадают');
  });

  it('keeps stop-protection active when router override remains but Mihomo DNS is off', () => {
    const state = { dnsOverride: true, mihomoDns: false, portListener: null, nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', 'handoff', { status: state, loading: false, error: null, busy: false, confirm: false });
    expect(view).toContain('Нужно проверить');
    expect(view).toContain('Вернуть DNS KeeneticOS');
    expect(view).toContain('Состояния DNS не совпадают');
  });

  it('requires an explicit second step before changing router DNS', () => {
    const view = renderDns(null, false, null, '', 'A', 'handoff');
    expect(view).toContain('Статус неизвестен');
    expect(view).toContain('id="dns-management-toggle" type="button" disabled');
  });

  it('explains that Keenetic DNS is restored before Mihomo DNS is disabled', () => {
    const state = { dnsOverride: true, mihomoDns: true, portListener: 'mihomo', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', 'handoff', { status: state, loading: false, error: null, busy: false, confirm: true });
    expect(view).toContain('Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.');
  });

  it('shows the DNS handoff prerequisites before enabling', () => {
    const state = { dnsOverride: false, mihomoDns: false, portListener: 'dnsmasq', nameServers: ['77.88.8.8'], detail: 'Состояние получено' };
    const view = renderDns(null, false, null, '', 'A', 'handoff', { status: state, loading: false, error: null, busy: false, confirm: true });
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
});
