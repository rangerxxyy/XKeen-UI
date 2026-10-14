import { describe, expect, it } from 'vitest';
import { parse as parseJsonc } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { getBundledTemplates, getDefaultTemplate } from './templates';

describe('bundled routing templates', () => {
  it('starts Mihomo in blocked-services-only mode and bundles the RU-exempt proxy mode', () => {
    const [blocked, proxyExceptRu] = getBundledTemplates('mihomo');
    expect(getDefaultTemplate('mihomo')).toBe(blocked);
    expect(blocked?.content).toContain('name: Заблок. сервисы');
    expect(blocked?.content).toContain('MATCH,DIRECT');
    expect(proxyExceptRu?.content).toContain('name: PROXY');
    expect(proxyExceptRu?.content).toContain('category-ru@domain');
    expect(proxyExceptRu?.content).toContain('MATCH,PROXY');
    expect(parseDocument(blocked?.content ?? '', { uniqueKeys: true, version: '1.2' }).errors).toHaveLength(0);
    expect(parseDocument(proxyExceptRu?.content ?? '', { uniqueKeys: true, version: '1.2' }).errors).toHaveLength(0);
  });

  it('starts Xray in blocked-services-only routing mode and bundles RU-exempt proxy routing', () => {
    const [blocked, proxyExceptRu] = getBundledTemplates('xray');
    expect(getDefaultTemplate('xray')).toBe(blocked);
    expect(blocked?.content).toContain('ext:zkeen.dat:domains');
    expect(blocked?.content).toContain('"outboundTag": "direct"');
    expect(proxyExceptRu?.content).toContain('category-ru');
    expect(proxyExceptRu?.content).toContain('"outboundTag": "vless-reality"');
    expect(() => parseJsonc(blocked?.content ?? '')).not.toThrow();
    expect(() => parseJsonc(proxyExceptRu?.content ?? '')).not.toThrow();
  });
});
