import { describe, expect, it } from 'vitest';
import { generateConfigForCore } from './outbound-parser';

describe('proxy link generator', () => {
  it('creates a Mihomo YAML proxy from a VLESS share link', () => {
    const result = generateConfigForCore('vless://uuid@example.com:443?encryption=none&type=tcp#test-node', 'mihomo');
    expect(result.type).toBe('proxy');
    expect(result.content).toContain("name: 'test-node'");
    expect(result.content).toContain('type: vless');
    expect(result.content).toContain('server: example.com');
  });

  it('decodes a base64 Shadowsocks credential and preserves its label', () => {
    const credentials = btoa('aes-128-gcm:router-secret');
    const result = generateConfigForCore(`ss://${credentials}@ss.example.net:8388#Sweden`, 'mihomo');

    expect(result.type).toBe('proxy');
    expect(result.content).toContain("name: 'Sweden'");
    expect(result.content).toContain('type: ss');
    expect(result.content).toContain('cipher: aes-128-gcm');
    expect(result.content).toContain('password: router-secret');
    expect(result.content).toContain('server: ss.example.net');
  });

  it('decodes a base64 VMess payload and retains WebSocket TLS settings', () => {
    const payload = btoa(JSON.stringify({
      add: 'vmess.example.net', port: '443', id: '00000000-0000-0000-0000-000000000001',
      ps: 'VMess Sweden', net: 'ws', tls: 'tls', sni: 'example.net', host: 'cdn.example.net', path: '/tunnel',
    }));
    const result = generateConfigForCore(`vmess://${payload}`, 'mihomo');

    expect(result.type).toBe('proxy');
    expect(result.content).toContain("name: 'VMess Sweden'");
    expect(result.content).toContain('type: vmess');
    expect(result.content).toContain('server: vmess.example.net');
    expect(result.content).toContain('network: ws');
    expect(result.content).toContain('servername: example.net');
    expect(result.content).toContain('path: /tunnel');
  });

  it('rejects unsupported share-link protocols', () => {
    expect(() => generateConfigForCore('ftp://example.com:21', 'mihomo')).toThrow();
  });

  it('recognizes HTTPS subscription URLs regardless of scheme casing', () => {
    const result = generateConfigForCore('HTTPS://sub.example.net/list', 'mihomo');
    expect(result.type).toBe('proxy-provider');
    expect(result.content.toLowerCase()).toContain('url: https://sub.example.net/list');
  });
});
