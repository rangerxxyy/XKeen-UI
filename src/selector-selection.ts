import type { MihomoSelector } from './api';

export function getAffectedConnectionIds(connections: readonly { id: string; chains: readonly string[] }[], groupName: string): string[] {
  return [...new Set(connections.filter((connection) => connection.chains.includes(groupName)).map((connection) => connection.id))];
}

export function selectProxyOptimistically(groups: MihomoSelector[], groupName: string, proxyName: string): MihomoSelector[] {
  const group = groups.find((candidate) => candidate.name === groupName);
  if (!group || !group.options.some((option) => option.name === proxyName)) return groups;

  return groups.map((candidate) => candidate === group ? { ...candidate, current: proxyName } : candidate);
}

export function restoreProxySelection(groups: MihomoSelector[], groupName: string, proxyName: string | null): MihomoSelector[] {
  const group = groups.find((candidate) => candidate.name === groupName);
  if (!group) return groups;
  return groups.map((candidate) => candidate === group ? { ...candidate, current: proxyName } : candidate);
}
