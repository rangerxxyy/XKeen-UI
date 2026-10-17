import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMihomoConnections } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('connection address formatting', () => {
  it.each([
    ['2001:db8::1', 443, '[2001:db8::1]:443'],
    ['[2001:db8::1]', 443, '[2001:db8::1]:443'],
    ['192.0.2.2', 443, '192.0.2.2:443'],
    ['example.com', '443', 'example.com:443'],
    ['2001:db8::1', undefined, '2001:db8::1'],
  ])('formats %s with port %s unambiguously', async (host, port, expected) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      connections: [{ id: 'fixture', metadata: {
        sourceIP: host, sourcePort: port, destinationIP: host, destinationPort: port,
      } }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    const result = await getMihomoConnections();
    expect(result.connections[0]?.source).toBe(expected);
    expect(result.connections[0]?.destination).toBe(expected);
  });
});
