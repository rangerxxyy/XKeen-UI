import { describe, expect, it } from 'vitest';
import { applyPingResults, orderSelectorsByConfig, renderConnections, renderSelectors } from './mihomo-view';
import type { MihomoConnections, MihomoSelector } from './api';

describe('applyPingResults', () => {
  it('updates shared nodes in every visible group and preserves unrelated nodes', () => {
    const groups: MihomoSelector[] = [
      { name: 'Main', icon: null, current: 'Finland', options: [
        { name: 'Finland', type: 'VLESS', icon: null, alive: null, delay: null },
        { name: 'DIRECT', type: 'Direct', icon: null, alive: true, delay: 5 },
      ] },
      { name: 'YouTube', icon: null, current: 'DIRECT', options: [
        { name: 'Finland', type: 'VLESS', icon: null, alive: null, delay: null },
        { name: 'DIRECT', type: 'Direct', icon: null, alive: true, delay: 5 },
      ] },
    ];
    const updated = applyPingResults(groups, [{ name: 'Finland', delay: 37 }]);
    expect(updated[0]?.options[0]).toMatchObject({ alive: true, delay: 37 });
    expect(updated[1]?.options[0]).toMatchObject({ alive: true, delay: 37 });
    expect(updated[0]?.options[1]).toMatchObject({ alive: true, delay: 5 });
  });

  it('marks a node unavailable when its ping fails', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'Offline', type: 'VLESS', icon: null, alive: true, delay: 88 },
    ] }];
    expect(applyPingResults(groups, [{ name: 'Offline', delay: null }])[0]?.options[0])
      .toMatchObject({ alive: false, delay: null });
  });
});

describe('renderSelectors', () => {
  it('renders an independent ping control on each node card', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'Finland', type: 'VLESS', icon: null, alive: null, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('data-ping-proxy="Finland"');
    expect(html).toContain('data-ping-group="Main"');
    expect(html).toContain('aria-label="Проверить ping узла Finland"');
  });
});

describe('renderConnections', () => {
  it('renders compact connection cards with clear route, host, protocol, source and traffic icons', () => {
    const data: MihomoConnections = {
      uploadTotal: 2048,
      downloadTotal: 4096,
      connections: [{
        id: 'conn-1', host: 'example.com:443', destination: '203.0.113.10:443', source: '192.168.1.20',
        network: 'tcp', process: 'browser', chains: ['Main', 'Finland'], rule: 'DOMAIN-SUFFIX',
        rulePayload: 'example.com', upload: 1024, download: 2048, start: '2026-10-16T12:00:00Z',
      }],
    };
    const html = renderConnections(data, false, null);
    expect(html).toContain('class="connection-grid"');
    expect(html).toContain('class="connection-card"');
    expect(html).toContain('example.com:443');
    expect(html).toContain('title="Сетевой протокол"');
    expect(html).toContain('192.168.1.20');
    expect(html).toContain('is-upload');
    expect(html).toContain('is-download');
    expect(html).not.toContain('<table');
  });
});

describe('orderSelectorsByConfig', () => {
  it('uses proxy-groups order from the active YAML and keeps unlisted groups last', () => {
    const groups: MihomoSelector[] = [
      { name: 'AI', icon: null, current: null, options: [] },
      { name: 'YouTube', icon: null, current: null, options: [] },
      { name: 'Main⚡', icon: null, current: null, options: [] },
      { name: 'Unlisted', icon: null, current: null, options: [] },
    ];
    const ordered = orderSelectorsByConfig(groups, `proxy-groups:\n  - name: Main⚡\n  - name: YouTube\n  - name: AI\n`);
    expect(ordered.map((group) => group.name)).toEqual(['Main⚡', 'YouTube', 'AI', 'Unlisted']);
  });

  it('preserves runtime order when the config is invalid or has no proxy-groups', () => {
    const groups: MihomoSelector[] = [
      { name: 'AI', icon: null, current: null, options: [] },
      { name: 'Main', icon: null, current: null, options: [] },
    ];
    expect(orderSelectorsByConfig(groups, 'bad: [yaml')).toEqual(groups);
    expect(orderSelectorsByConfig(groups, 'dns:\n  enable: true\n')).toEqual(groups);
  });
});
