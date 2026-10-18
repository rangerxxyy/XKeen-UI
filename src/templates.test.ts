import { describe, expect, it } from 'vitest';
import { parse as parseJsonc } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { getBundledTemplates, getDefaultTemplate } from './templates';

describe('bundled routing templates', () => {
  it('offers the same core-specific template choices as zxc-rv', () => {
    expect(getBundledTemplates('mihomo').map(({ name }) => name)).toEqual([
      'Сonfig (только заблокированное, refilter+zkeenip)',
      'Сonfig (все в прокси, кроме RU)',
    ]);
    expect(getBundledTemplates('xray').map(({ name }) => name)).toEqual([
      'Log',
      'Inbounds (Режим Mixed)',
      'Inbounds (Режим TProxy)',
      'Inbounds (Режим Mixed+DSCP)',
      'Inbounds (Режим TProxy+DSCP)',
      'Outbounds',
      'Routing (только заблокированное, zkeen)',
      'Routing (все в прокси, кроме RU)',
      'Policy',
    ]);
  });

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
    const templates = getBundledTemplates('xray');
    const blocked = templates.find(({ name }) => name.includes('Routing (только заблокированное'));
    const proxyExceptRu = templates.find(({ name }) => name.includes('Routing (все в прокси'));
    expect(getDefaultTemplate('xray')).toBe(blocked);
    expect(blocked?.content).toContain('ext:zkeen.dat:domains');
    expect(blocked?.content).toContain('"outboundTag": "direct"');
    expect(proxyExceptRu?.content).toContain('category-ru');
    expect(proxyExceptRu?.content).toContain('"outboundTag": "vless-reality"');
    for (const template of templates) expect(() => parseJsonc(template.content)).not.toThrow();
  });
});
