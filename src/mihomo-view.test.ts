import { describe, expect, it } from 'vitest';
import { applyPingResults, collectConnectionProxyIcons, orderSelectorsByConfig, renderConnections, renderPingStatusIcon, renderSelectorDestination, renderSelectors } from './mihomo-view';
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
  it('keeps the selector layout occupied with a skeleton while groups load', () => {
    const html = renderSelectors([], true, null);
    expect(html).toContain('class="selector-list selector-list-skeleton"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('skeleton-option');
    expect(html).not.toContain('loading-orbit');
  });

  it('does not render Mihomo’s internal GLOBAL selector', () => {
    const groups: MihomoSelector[] = [
      { name: 'Main', icon: null, current: null, options: [] },
      { name: 'GLOBAL', icon: null, current: 'Main', options: [] },
    ];
    const html = renderSelectors(groups, false, null);
    expect(html).toContain('>Main</h2>');
    expect(html).not.toContain('GLOBAL');
  });

  it('shows the complete selected route through nested selectors to the actual node', () => {
    const groups: MihomoSelector[] = [
      { name: 'AI', type: 'Selector', icon: null, current: 'Main', options: [] },
      { name: 'Main', type: 'Selector', icon: null, current: 'Finland · TCP', options: [] },
    ];
    const html = renderSelectors(groups, false, null);
    expect(html).not.toContain('Куда:');
    expect(html).toContain('class="selector-route-arrow"');
    expect(html).toContain('data-selector-destination="Main → Finland · TCP"');
    expect(html).toContain('title="Маршрут: Main → Finland · TCP"');
  });

  it('clearly labels auto-managed selectors when Mihomo has not chosen a destination yet', () => {
    const html = renderSelectors([{ name: 'Fastest', type: 'URLTest', icon: null, current: null, options: [] }], false, null);
    expect(html).toContain('Автовыбор Mihomo');
    expect(html).toContain('data-selector-destination="Автовыбор Mihomo"');
  });

  it('keeps a crisp ping status icon for healthy, unknown, and unavailable nodes', () => {
    const html = renderPingStatusIcon(true);
    expect(html).toContain('class="ping-status-icon is-alive"');
    expect(html).toContain('M4.5 8.5');
    expect(renderPingStatusIcon(null)).toContain('M9 1');
    expect(renderPingStatusIcon(false)).toContain('class="ping-status-icon is-dead"');
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
    expect(html).toContain('class="ping-status-icon is-dead"');
    expect(html).toContain('Узел не отвечает. Нажмите, чтобы проверить ping');
    expect(renderPingStatusIcon(false)).toContain('M5 2.5h6l2 2v7l-5 2-5-2v-7z');
    expect(renderPingStatusIcon(false)).toContain('m6.3 5.8 3.4 3.4m0-3.4L6.3 9.2');
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

describe('renderSelectorDestination', () => {
  it('updates the displayed route when a selector target changes', () => {
    const groups: MihomoSelector[] = [
      { name: 'Main', type: 'Selector', icon: null, current: 'Finland', options: [{ name: 'Finland', type: 'VLESS', icon: null, alive: true, delay: 20 }] },
      { name: 'YouTube', type: 'Selector', icon: null, current: 'Main', options: [{ name: 'Main', type: 'Selector', icon: null, alive: true, delay: 0 }] },
    ];
    expect(renderSelectorDestination(groups[1]!, groups)).toContain('Finland');
    const switched = [{ ...groups[0]!, current: 'Sweden' }, groups[1]!];
    expect(renderSelectorDestination(switched[1]!, switched)).toContain('Sweden');
  });
});

describe('renderConnections', () => {
  it('keeps the connection toolbar and rows occupied with a skeleton while loading', () => {
    const html = renderConnections(null, true, null);
    expect(html).toContain('class="connections-panel connection-skeleton"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="connection-skeleton-row"');
    expect(html).not.toContain('loading-orbit');
  });

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
    expect(html).toContain('<tbody><tr data-connection-id="conn-1" data-search=');
    expect(html).toContain('example.com:443');
    expect(html).toContain('title="Сетевой протокол"');
    expect(html).toContain('192.168.1.20');
    expect(html).toContain('is-upload');
    expect(html).toContain('is-download');
    expect(html).toContain('class="connection-count-pill"');
    expect(html).toContain('data-connection-sort="host"');
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
    expect(html).toContain('data-search="example.com:443 office laptop 192.168.1.20:53321');
    expect(html).not.toContain('>browser.exe</td>');
  });

  it('separates route hops and does not duplicate the route with a guessed service icon', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [
        { id: 'cdn', host: 'th.bing.com', destinationPort: 443, destination: '', source: 'PC', network: 'tcp', process: '', chains: ['DIRECT', 'CDN'], rule: 'DOMAIN-SUFFIX', rulePayload: 'bing.com', upload: 0, download: 0, start: '' },
        { id: 'direct', host: 'substrate.office.com:443', destination: '', source: 'PC', network: 'tcp', process: '', chains: ['DIRECT'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '' },
      ],
    };
    const html = renderConnections(data, false, null);
    expect(html).toContain('aria-label="Маршрут: CDN → DIRECT"');
    expect(html).toContain('class="connection-route-arrow"');
    expect(html).not.toContain('connection-route-node');
    expect(html).toContain('<span class="connection-route-hop" title="CDN"><span class="connection-route-label">CDN</span></span><span class="connection-route-arrow" aria-hidden="true">→</span><span class="connection-route-hop" title="DIRECT"><span class="connection-route-label">DIRECT</span></span>');
    expect(html).toContain('th.bing.com:443');
    expect(html).toContain('substrate.office.com:443');
    expect(html).toContain('DIRECT');
    expect(html).not.toContain('connection-app-icon');
  });

  it('keeps Mihomo route hops and uses their selector icons without guessed service decoration', () => {
    const data: MihomoConnections = {
      uploadTotal: 314, downloadTotal: 234,
      connections: [{
        id: 'telegram-1', host: '91.105.192.100:80', destination: '', source: 'PC-1080TI',
        network: 'tcp', process: '', chains: ['', '🇸🇪 ⚡ Sweden', 'Telegram', ''], rule: 'MATCH', rulePayload: '',
        upload: 314, download: 234, start: '2026-10-18T07:30:00Z',
      }],
    };
    const icons = collectConnectionProxyIcons([{
      name: 'Telegram', icon: 'https://icons.example/telegram.svg', current: null, options: [],
    }, {
      name: '🇸🇪 ⚡ Sweden', icon: null, current: null, options: [],
    }]);
    const html = renderConnections(data, false, null, false, {}, { key: 'start', direction: 'descending' }, icons);
    expect(html).toContain('aria-label="Маршрут: Telegram → 🇸🇪 ⚡ Sweden"');
    expect(html).toContain('<span class="connection-chain" role="group" aria-label="Маршрут: Telegram → 🇸🇪 ⚡ Sweden"');
    expect(html).toContain('<span class="connection-route-hop" title="Telegram"><span class="connection-route-label"><img class="connection-proxy-icon" src="https://icons.example/telegram.svg"');
    expect(html).toContain('<span class="connection-route-hop" title="🇸🇪 ⚡ Sweden"><span class="connection-route-label"><span class="country-flag flag-se"');
    expect(html).not.toContain('connection-app-icon');
    expect(html).toContain('<span class="country-flag flag-se"');
    expect(html).not.toContain('imageTelegramsvg');
    expect(html).not.toContain('>›</span> <span aria-hidden="true">›</span>');
  });

  it('uses Mihomo proxy icons for the first and final route hops like zxc-rv', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [{
        id: 'three-hop', host: 'example.com', destination: '', source: 'PC', network: 'tcp', process: '',
        chains: ['Exit', 'Middle', 'Main'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '',
      }],
    };
    const selectors: MihomoSelector[] = [{
      name: 'Main', icon: 'https://icons.example/main.svg', current: 'Exit', options: [
        { name: 'Exit', type: 'VLESS', icon: 'https://icons.example/exit.svg', alive: true, delay: 10 },
        { name: 'Middle', type: 'VLESS', icon: 'https://icons.example/middle.svg', alive: true, delay: 10 },
      ],
    }];
    const icons = collectConnectionProxyIcons(selectors);
    const html = renderConnections(data, false, null, false, {}, { key: 'start', direction: 'descending' }, icons);

    expect(html).toContain('src="https://icons.example/main.svg"');
    expect(html).toContain('src="https://icons.example/exit.svg"');
    expect(html).not.toContain('src="https://icons.example/middle.svg"');
    expect(html).toContain('Маршрут: Main → Middle → Exit');
    expect(html).toContain('<span class="connection-route-hop" title="Main"><span class="connection-route-label"><img class="connection-proxy-icon" src="https://icons.example/main.svg" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">Main</span></span><span class="connection-route-arrow"');
    expect(html).toContain('<span class="connection-route-label"><img class="connection-proxy-icon" src="https://icons.example/exit.svg" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">Exit</span>');
  });

  it('does not infer service icons from connection hosts', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [{
        id: 'github', host: 'github.com', destination: '', source: 'PC', network: 'tcp', process: '',
        chains: ['🇸🇪 ⚡ Sweden'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '',
      }],
    };
    const html = renderConnections(data, false, null);

    expect(html).not.toContain('connection-app-icon');
    expect(html).toContain('Маршрут: 🇸🇪 ⚡ Sweden');
    expect(html).toContain('<span class="connection-route-label"><span class="country-flag flag-se"');
  });

  it('shows the exact proxy route regardless of the destination service', () => {
    const cases: Array<[string, string, string]> = [
      ['api.github.com', 'github', 'GitHub'],
      ['chatgpt.com', 'ai', 'AI'],
      ['scontent.cdninstagram.com', 'meta', 'Meta'],
      ['webcast.tiktokv.com', 'tiktok', 'TikTok'],
      ['accounts.google.com', 'google', 'Google'],
      ['youtube.googleapis.com', 'youtube', 'YouTube'],
    ];

    for (const [host, service, label] of cases) {
      const data: MihomoConnections = {
        uploadTotal: 0, downloadTotal: 0,
        connections: [{
          id: service, host, destination: '', source: 'PC', network: 'tcp', process: '',
          chains: ['DIRECT'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '',
        }],
      };
      const html = renderConnections(data, false, null);

      expect(html).not.toContain('connection-app-icon');
      expect(html).toContain('Маршрут: DIRECT');
      expect(html).not.toContain(`Маршрут: ${label} → DIRECT`);
    }
  });

  it('preserves a real Main hop between a service and the selected proxy', () => {
    const data: MihomoConnections = {
      uploadTotal: 0, downloadTotal: 0,
      connections: [{
        id: 'github-main', host: 'github.com', destination: '', source: 'PC', network: 'tcp', process: '',
        chains: ['🇫🇮 ⚡ Finland · TCP', 'Main'], rule: 'MATCH', rulePayload: '', upload: 0, download: 0, start: '',
      }],
    };
    const html = renderConnections(data, false, null);

    expect(html).toContain('Маршрут: Main → 🇫🇮 ⚡ Finland · TCP');
    expect(html).toContain('<span class="connection-route-hop" title="Main"><span class="connection-route-label">Main</span></span>');
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
