import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { convertAmneziaConfig, renderAmneziaImportActionMarkup } from './amnezia-import';
import { appendMihomoProxy } from './proxy-import';

describe('convertAmneziaConfig', () => {
  it('converts a WireGuard .conf with Amnezia 2 options into a Mihomo proxy', () => {
    const source = `[Interface]\nPrivateKey = private-key\nAddress = 10.8.0.2/32, fd00::2/128\nDNS = 1.1.1.1, 8.8.8.8\nVersion = 2.0\nJc = 4\nJmin = 40\nJmax = 70\nS1 = 10\nS2 = 20\n\n[Peer]\nPublicKey = public-key\nPresharedKey = shared-key\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = [2001:db8::1]:51820\nPersistentKeepalive = 25\n`;

    const converted = convertAmneziaConfig(source, 'office.conf');
    const updated = appendMihomoProxy('mode: rule\nproxies:\n  - name: existing\n    type: direct\n', converted.yaml);
    const config = parseYaml(updated) as { mode: string; proxies: Array<Record<string, unknown>> };
    const proxy = config.proxies[1];

    expect(converted.version).toEqual({ version: '2.0', confidence: 'exact' });
    expect(config.mode).toBe('rule');
    expect(proxy).toMatchObject({
      name: 'office', type: 'wireguard', server: '2001:db8::1', port: 51820,
      ip: '10.8.0.2/32', 'private-key': 'private-key', 'public-key': 'public-key',
      'pre-shared-key': 'shared-key', 'allowed-ips': ['0.0.0.0/0', '::/0'],
      'persistent-keepalive': 25, dns: ['1.1.1.1', '8.8.8.8'], mtu: 1280, udp: true,
      'amnezia-wg-option': { version: 2, jc: 4, jmin: 40, jmax: 70, s1: 10, s2: 20 },
    });
    expect(converted.yaml).toContain('private-key: private-key');
    expect(converted.previewYaml).toContain('private-key: ••••••••');
    expect(converted.previewYaml).toContain('public-key: ••••••••');
    expect(converted.previewYaml).toContain('pre-shared-key: ••••••••');
    expect(converted.previewYaml).not.toContain('private-key: private-key');
    expect(converted.previewYaml).not.toContain('public-key: public-key');
    expect(converted.previewYaml).not.toContain('pre-shared-key: shared-key');
  });

  it('rejects a config without a peer endpoint instead of generating a broken proxy', () => {
    expect(() => convertAmneziaConfig('[Interface]\nPrivateKey = key\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = key', 'bad.conf'))
      .toThrow('[Peer 1] отсутствует Endpoint');
  });

  it('keeps Amnezia 1.5 handshake options without treating its source version as Mihomo version', () => {
    const source = `[Interface]\nPrivateKey = private-key\nAddress = 10.0.0.2/32\nVersion = 1.5\nJ1 = <b 0xffffffff><c>\nJ2 = <c><t>\nJ3 = <t><b 0xf6ab>\nItime = 60\nS3 = 30\nS4 = 40\nI1 = <b 0xf6ab><t>\n[Peer]\nPublicKey = public-key\nEndpoint = example.com:51820\n`;
    const converted = convertAmneziaConfig(source, 'legacy.conf');
    const proxy = (parseYaml(converted.yaml) as Array<Record<string, unknown>>)[0];
    expect(proxy?.['amnezia-wg-option']).toEqual({
      version: 2, j1: '<b 0xffffffff><c>', j2: '<c><t>', j3: '<t><b 0xf6ab>', itime: 60, s3: 30, s4: 40, i1: '<b 0xf6ab><t>',
    });
  });

  it('renders one unambiguous action that appends the imported proxy to the config', () => {
    expect(renderAmneziaImportActionMarkup()).toBe('<button class="editor-button editor-button-primary" type="button" data-amnezia-add>Добавить в конфигурацию</button>');
  });
});
