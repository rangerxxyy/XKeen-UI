import { describe, expect, it } from 'vitest';
import type { MihomoSelector } from './api';
import { getAffectedConnectionIds, restoreProxySelection, selectProxyOptimistically } from './selector-selection';

const groups: MihomoSelector[] = [
  { name: 'Main', current: 'Sweden', icon: null, options: [
    { name: 'Sweden', type: 'VLESS', icon: null, alive: true, delay: 50 },
    { name: 'Finland', type: 'VLESS', icon: null, alive: true, delay: 60 },
  ] },
  { name: 'Fallback', current: 'DIRECT', icon: null, options: [
    { name: 'DIRECT', type: 'Direct', icon: null, alive: true, delay: 0 },
  ] },
];

describe('optimistic selector state', () => {
  it('updates only the requested valid group before the network response', () => {
    const updated = selectProxyOptimistically(groups, 'Main', 'Finland');

    expect(updated[0]?.current).toBe('Finland');
    expect(updated[1]).toBe(groups[1]);
    expect(groups[0]?.current).toBe('Sweden');
  });

  it('keeps the previous state when a group or proxy is unknown', () => {
    expect(selectProxyOptimistically(groups, 'Missing', 'Finland')).toBe(groups);
    expect(selectProxyOptimistically(groups, 'Main', 'Missing')).toBe(groups);
  });

  it('restores a server-confirmed selection, including no selection', () => {
    expect(restoreProxySelection(selectProxyOptimistically(groups, 'Main', 'Finland'), 'Main', 'Sweden')[0]?.current).toBe('Sweden');
    expect(restoreProxySelection(groups, 'Main', null)[0]?.current).toBeNull();
  });
});

describe('connections affected by a selector switch', () => {
  it('returns only active connection ids whose route includes the switched group', () => {
    expect(getAffectedConnectionIds([
      { id: 'via-main', chains: ['Main', 'Finland'] },
      { id: 'via-main', chains: ['Main'] },
      { id: 'via-other', chains: ['Other', 'Sweden'] },
      { id: 'direct', chains: [] },
    ], 'Main')).toEqual(['via-main']);
  });
});
