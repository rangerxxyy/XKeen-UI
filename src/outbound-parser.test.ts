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

  it('rejects unsupported share-link protocols', () => {
    expect(() => generateConfigForCore('ftp://example.com:21', 'mihomo')).toThrow();
  });

  it('recognizes HTTPS subscription URLs regardless of scheme casing', () => {
    const result = generateConfigForCore('HTTPS://sub.example.net/list', 'mihomo');
    expect(result.type).toBe('proxy-provider');
    expect(result.content.toLowerCase()).toContain('url: https://sub.example.net/list');
  });
});
