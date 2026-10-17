import { describe, expect, it, vi } from 'vitest';
import { SourceNameResolver, parseDeviceNames } from './source-names';

describe('Keenetic source names', () => {
  it('maps IPv4 and IPv6 device addresses to the advertised device name', () => {
    expect(parseDeviceNames({ host: [
      { name: 'Living room', ip: '192.168.1.20', ip6: ['fd00::20'] },
      { hostname: 'Laptop', ip: '192.168.1.21' },
    ] })).toEqual(new Map([
      ['192.168.1.20', 'Living room'], ['fd00::20', 'Living room'], ['192.168.1.21', 'Laptop'],
    ]));
  });

  it('caches successful names and briefly backs off missing devices', async () => {
    const fetchNames = vi.fn(async () => ({ host: [{ name: 'Laptop', ip: '192.168.1.21' }] }));
    const resolver = new SourceNameResolver(fetchNames, () => 1000);
    await expect(resolver.resolve(['192.168.1.21', '192.168.1.22'])).resolves.toEqual({ '192.168.1.21': 'Laptop' });
    await resolver.resolve(['192.168.1.21', '192.168.1.22']);
    expect(fetchNames).toHaveBeenCalledTimes(1);
  });

  it('retries unresolved devices after the short backoff expires', async () => {
    let now = 0;
    const fetchNames = vi.fn(async () => ({ host: [] }));
    const resolver = new SourceNameResolver(fetchNames, () => now);
    await resolver.resolve(['192.168.1.22']);
    await resolver.resolve(['192.168.1.22']);
    now = 3001;
    await resolver.resolve(['192.168.1.22']);
    expect(fetchNames).toHaveBeenCalledTimes(2);
  });
});
