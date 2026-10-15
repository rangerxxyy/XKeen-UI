import { describe, expect, it } from 'vitest';
import { applyPingResults, orderSelectorsByConfig, renderSelectors } from './mihomo-view';
import type { MihomoSelector } from './api';

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
    expect(html).toContain('aria-label="Проверить задержку узла Finland"');
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
