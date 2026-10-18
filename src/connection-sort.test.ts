import { describe, expect, it } from 'vitest';
import type { MihomoConnection } from './api';
import { getConnectionHost, sortMihomoConnections, type ConnectionSort } from './connection-sort';

function row(overrides: Partial<MihomoConnection>): MihomoConnection {
  return {
    id: 'row', host: '', destination: '', source: '', network: 'tcp', process: '', chains: [], rule: '', rulePayload: '',
    upload: 0, download: 0, start: '', ...overrides,
  };
}

describe('sortMihomoConnections', () => {
  it('sorts by the displayed route and keeps equal rows stable', () => {
    const connections = [
      row({ id: 'b', chains: ['DIRECT', 'Telegram'] }),
      row({ id: 'a', chains: ['DIRECT', 'Google'] }),
      row({ id: 'c', chains: ['DIRECT', 'Google'] }),
    ];
    const sort: ConnectionSort = { key: 'route', direction: 'ascending' };

    expect(sortMihomoConnections(connections, sort).map(({ id }) => id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts traffic numerically rather than lexicographically', () => {
    const connections = [row({ id: 'large', upload: 1024 }), row({ id: 'small', upload: 99 })];
    const sort: ConnectionSort = { key: 'traffic', direction: 'descending' };

    expect(sortMihomoConnections(connections, sort).map(({ id }) => id)).toEqual(['large', 'small']);
  });

  it('uses the visible device name when sorting by source', () => {
    const connections = [
      row({ id: 'pc', source: '192.168.1.5:5000', sourceIp: '192.168.1.5' }),
      row({ id: 'phone', source: '192.168.1.6:5000', sourceIp: '192.168.1.6' }),
    ];
    const sort: ConnectionSort = { key: 'source', direction: 'ascending' };

    expect(sortMihomoConnections(connections, sort, { '192.168.1.5': 'Zebra PC', '192.168.1.6': 'Android' }).map(({ id }) => id))
      .toEqual(['phone', 'pc']);
  });

  it('formats IPv4 and IPv6 destinations with their ports', () => {
    const connections = [
      row({ id: 'v4', host: '91.105.192.100', destinationPort: 80 }),
      row({ id: 'v6', host: '2001:db8::1', destinationPort: 443 }),
    ];
    const sort: ConnectionSort = { key: 'host', direction: 'ascending' };

    expect(connections.map(getConnectionHost)).toEqual(['91.105.192.100:80', '[2001:db8::1]:443']);
    expect(sortMihomoConnections(connections, sort).map(({ id }) => id)).toEqual(['v6', 'v4']);
  });
});
