import type { MihomoConnection } from './api';

export type ConnectionSortKey = 'route' | 'host' | 'network' | 'source' | 'traffic' | 'start';
export interface ConnectionSort {
  key: ConnectionSortKey;
  direction: 'ascending' | 'descending';
}

export function displayedConnectionChains(connection: MihomoConnection): string[] {
  return connection.chains
    .filter((chain): chain is string => typeof chain === 'string' && chain.trim().length > 0)
    .map((chain) => chain.trim())
    .reverse();
}

export function getConnectionHost(connection: MihomoConnection): string {
  const rawHost = connection.host.trim();
  const port = connection.destinationPort;
  if (!rawHost) return connection.destination || 'Адрес недоступен';
  if (!port || /^\[[^\]]+\]:\d+$/.test(rawHost) || /^[^:]+:\d+$/.test(rawHost)) return rawHost;
  const host = rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost;
  return `${host}:${port}`;
}

function valueFor(connection: MihomoConnection, key: ConnectionSortKey, sourceNames: Record<string, string>): string | number {
  switch (key) {
    case 'route': return displayedConnectionChains(connection).join(' › ');
    case 'host': return getConnectionHost(connection);
    case 'network': return connection.network;
    case 'source': return (connection.sourceIp && sourceNames[connection.sourceIp]) || connection.source;
    case 'traffic': return connection.upload + connection.download;
    case 'start': {
      const timestamp = Date.parse(connection.start);
      return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    }
  }
}

export function sortMihomoConnections(
  connections: MihomoConnection[],
  sort: ConnectionSort,
  sourceNames: Record<string, string> = {},
): MihomoConnection[] {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return connections
    .map((connection, index) => ({ connection, index, value: valueFor(connection, sort.key, sourceNames) }))
    .sort((left, right) => {
      const comparison = typeof left.value === 'number' && typeof right.value === 'number'
        ? left.value - right.value
        : String(left.value).localeCompare(String(right.value), 'ru', { numeric: true, sensitivity: 'base' });
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ connection }) => connection);
}
