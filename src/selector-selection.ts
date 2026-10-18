import type { MihomoSelector } from './api';

export function queueSelectorWrite(
  queues: Map<string, Promise<void>>,
  groupName: string,
  write: () => Promise<void>,
  afterAccepted: () => void | Promise<void>,
): Promise<void> {
  const previous = queues.get(groupName) ?? Promise.resolve();
  const request = previous.catch(() => undefined).then(write);
  queues.set(groupName, request);
  void request.then(
    () => {
      try {
        void Promise.resolve(afterAccepted()).catch(() => undefined);
      } catch {
        // A follow-up action must not hold the queue or turn an accepted choice into a failure.
      }
    },
    () => undefined,
  ).finally(() => {
    if (queues.get(groupName) === request) queues.delete(groupName);
  }).catch(() => undefined);
  return request;
}

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
