import { describe, expect, it } from 'vitest';
import { applyPingResults, orderSelectorsByConfig, renderConnections, renderPingStatusIcon, renderSelectors } from './mihomo-view';
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
  it('does not render Mihomo’s internal GLOBAL selector', () => {
    const groups: MihomoSelector[] = [
      { name: 'Main', icon: null, current: null, options: [] },
      { name: 'GLOBAL', icon: null, current: 'Main', options: [] },
    ];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('>Main</h2>');
    expect(html).not.toContain('GLOBAL');
  });

  it('leaves successful ping as a number and uses lightning before testing', () => {
    const html = renderPingStatusIcon(true);
    expect(html).toBe('');
    expect(renderPingStatusIcon(null)).toContain('M9 1');
    expect(html).not.toContain('M2 5.4');
  });

  it('renders ISO country prefixes with bundled SVG flag icons in node names and selected routes', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: 'fi ⚡ Finland · TCP', options: [
      { name: 'fi ⚡ Finland · TCP', type: 'VLESS', icon: null, alive: null, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('<span class="country-flag flag-fi" role="img" aria-label="FI"></span> ⚡ Finland · TCP');
    expect(html).not.toContain('🇫🇮');
    expect(html).not.toContain('>fi ⚡ Finland · TCP<');
    expect(html).toContain('data-proxy-name="fi ⚡ Finland · TCP"');
  });

  it('replaces leading Unicode country flags from live Mihomo names with bundled SVG icons', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: '🇫🇮 ⚡ Finland · TCP', options: [
      { name: '🇫🇮 ⚡ Finland · TCP', type: 'VLESS', icon: null, alive: null, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('<span class="country-flag flag-fi" role="img" aria-label="FI"></span> ⚡ Finland · TCP');
    expect(html.match(/country-flag flag-fi/g)).toHaveLength(2);
  });

  it('does not treat ordinary words such as No ads as country prefixes', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'No ads YT', type: 'Hysteria2', icon: null, alive: null, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('>No ads YT</strong>');
    expect(html).not.toContain('country-flag');
  });

  it('renders an independent ping control on each node card', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'Finland', type: 'VLESS', icon: null, alive: null, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('data-ping-proxy="Finland"');
    expect(html).toContain('data-ping-group="Main"');
    expect(html).toContain('aria-label="Проверить ping. Нажмите, чтобы повторить ping узла Finland"');
  });

  it('shows automatic Fastest groups for ping without offering manual node selection', () => {
    const html = renderSelectors([{ name: 'Fastest', type: 'URLTest', icon: null, current: 'DIRECT', options: [
      { name: 'DIRECT', type: 'Direct', icon: null, alive: null, delay: null },
    ] }], false, null);
    expect(html).toContain('data-ping-group="Fastest"');
    expect(html).toContain('data-ping-proxy="DIRECT"');
    expect(html).toContain('disabled title="Узел выбирается ядром автоматически"');
  });

  it('shows a clear red failure marker when a node is unreachable', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'Offline', type: 'VLESS', icon: null, alive: false, delay: null },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('proxy-health proxy-ping-value is-dead');
    expect(html).toContain('class="ping-status-icon"');
    expect(html).toContain('Узел не отвечает. Нажмите, чтобы проверить ping');
    expect(renderPingStatusIcon(false)).toContain('M5 2.5h6l2 2v7l-5 2-5-2v-7z');
    expect(renderPingStatusIcon(false)).toContain('M8 5v4m-1.5-2h3');
  });

  it('keeps protocol and transport labels together for VLESS XUDP and Hysteria2 UDP nodes', () => {
    const groups: MihomoSelector[] = [{ name: 'Main', icon: null, current: null, options: [
      { name: 'VLESS node', type: 'VLESS', icon: null, alive: true, delay: 31, xudp: true },
      { name: 'Hysteria node', type: 'Hysteria2', icon: null, alive: true, delay: 45, udp: true },
    ] }];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('proxy-protocol-badge">vless</span><span class="proxy-transport-badge is-xudp">xudp</span>');
    expect(html).toContain('proxy-protocol-badge">hysteria2</span><span class="proxy-transport-badge is-udp">udp</span>');
  });
});

describe('renderConnections', () => {
  it('renders dense connection rows with route icons, host, protocol, source and traffic indicators', () => {
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
    expect(html).toContain('class="connection-table"');
    expect(html).toContain('<tbody><tr data-search=');
    expect(html).toContain('example.com:443');
    expect(html).toContain('title="Сетевой протокол"');
    expect(html).toContain('192.168.1.20');
    expect(html).toContain('is-upload');
    expect(html).toContain('is-download');
    expect(html).toContain('class="connection-count-pill"');
    expect(html).toContain('Хост <span>↕</span>');
    expect(html).toContain('class="connection-route-cell"');
    expect(html).not.toContain('connection-card');
  });

  it('shows a Keenetic device name instead of the source IP when name display is enabled', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [{
        id: 'named', host: 'example.com:443', destination: '', source: '192.168.1.20:53321', sourceIp: '192.168.1.20',
        network: 'tcp', process: 'browser.exe', chains: ['DIRECT'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '',
      }],
    };
    const html = renderConnections(data, false, null, true, { '192.168.1.20': 'Office laptop' });
    expect(html).toContain('title="Office laptop (192.168.1.20:53321)">Office laptop</td>');
    expect(html).not.toContain('>browser.exe</td>');
  });

  it('shows service icons before grouped routes and leaves DIRECT flows uncluttered', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [
        { id: 'cdn', host: 'th.bing.com', destinationPort: 443, destination: '', source: 'PC', network: 'tcp', process: '', chains: ['DIRECT', 'CDN'], rule: 'DOMAIN-SUFFIX', rulePayload: 'bing.com', upload: 0, download: 0, start: '' },
        { id: 'direct', host: 'substrate.office.com:443', destination: '', source: 'PC', network: 'tcp', process: '', chains: ['DIRECT'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '' },
      ],
    };
    const html = renderConnections(data, false, null);
    expect(html).toContain('class="connection-app-icon is-web"');
    expect(html).toContain('CDN › DIRECT');
    expect(html).toContain('th.bing.com:443');
    expect(html).toContain('substrate.office.com:443');
    expect(html).toContain('DIRECT');
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
