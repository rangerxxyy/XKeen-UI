import type { MihomoSelector } from './api';

export function selectProxyOptimistically(groups: MihomoSelector[], groupName: string, proxyName: string): MihomoSelector[] {
  const group = groups.find((candidate) => candidate.name === groupName);
  if (!group || !group.options.some((option) => option.name === proxyName)) return groups;

  return groups.map((candidate) => candidate === group ? { ...candidate, current: proxyName } : candidate);
}
