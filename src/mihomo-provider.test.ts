import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createMihomoProviderYaml, insertMihomoProvider, nextMihomoProviderName } from './mihomo-provider';

const provider = (name: string, url: string) => `${name}:\n  type: http\n  url: ${url}\n  interval: 43200\n`;

describe('Mihomo subscription providers', () => {
  it('chooses a provider name that does not overwrite an existing entry', () => {
    expect(nextMihomoProviderName('proxy-providers:\n  subscription_1:\n    type: http\n    url: https://old.example/sub\n')).toBe('subscription_2');
  });

  it('builds a provider from editable subscription settings', () => {
    const result = createMihomoProviderYaml({
      name: 'subscription_2',
      url: 'https://new.example/sub',
      interval: 21600,
      healthCheckEnabled: true,
      healthCheckUrl: 'https://www.gstatic.com/generate_204',
      healthCheckInterval: 300,
      expectedStatus: 204,
      headersEnabled: true,
      userAgent: 'ClashMeta/1.19.30; mihomo/1.19.30',
      hwid: 'F54F00D04041',
      udp: true,
      filtersEnabled: true,
      filter: 'my-good-proxy',
      excludeFilter: 'my-bad-proxy',
      excludeType: 'trojan|vmess',
    });
    const config = parse(result) as Record<string, Record<string, unknown>>;
    const value = config.subscription_2;
    expect(value?.url).toBe('https://new.example/sub');
    expect(value?.interval).toBe(21600);
    expect(value?.filter).toBe('my-good-proxy');
    expect(value?.['exclude-filter']).toBe('my-bad-proxy');
    expect(value?.['exclude-type']).toBe('trojan|vmess');
    expect((value?.header as Record<string, string[]>)?.['User-Agent']).toEqual(['ClashMeta/1.19.30; mihomo/1.19.30']);
  });

  it('inserts a provider at the start while retaining unrelated configuration', () => {
    const result = insertMihomoProvider(
      'mode: rule\nproxy-providers:\n  old:\n    type: http\n    url: https://old.example/sub\n    interval: 43200\n',
      provider('subscription_2', 'https://new.example/sub'),
      'start',
    );
    const config = parse(result) as { mode: string; 'proxy-providers': Record<string, { url: string }> };
    expect(config.mode).toBe('rule');
    expect(Object.keys(config['proxy-providers'])).toEqual(['subscription_2', 'old']);
    expect(config['proxy-providers'].subscription_2?.url).toBe('https://new.example/sub');
  });

  it('inserts a provider at the end of proxy-providers', () => {
    const result = insertMihomoProvider(
      'proxy-providers:\n  old:\n    type: http\n    url: https://old.example/sub\n    interval: 43200\n',
      provider('new', 'https://new.example/sub'),
      'end',
    );
    const config = parse(result) as { 'proxy-providers': Record<string, unknown> };
    expect(Object.keys(config['proxy-providers'])).toEqual(['old', 'new']);
  });

  it('connects a subscription to only the selected proxy groups', () => {
    const result = insertMihomoProvider(
      'proxy-groups:\n  - name: Select\n    type: select\n    proxies: [DIRECT]\n  - name: Auto\n    type: url-test\n    proxies: [DIRECT]\n',
      provider('new', 'https://new.example/sub'),
      'end',
      undefined,
      ['Select'],
    );
    const config = parse(result) as { 'proxy-groups': Array<{ name: string; use?: string[] }> };
    expect(config['proxy-groups'][0]?.use).toEqual(['new']);
    expect(config['proxy-groups'][1]?.use).toBeUndefined();
  });

  it('preserves existing provider references and rejects a missing selected group', () => {
    const source = 'proxy-groups:\n  - name: Select\n    type: select\n    use: [old]\n';
    const result = insertMihomoProvider(source, provider('new', 'https://new.example/sub'), 'end', undefined, ['Select']);
    const config = parse(result) as { 'proxy-groups': Array<{ use: string[] }> };
    expect(config['proxy-groups'][0]?.use).toEqual(['old', 'new']);
    expect(() => insertMihomoProvider(source, provider('new', 'https://new.example/sub'), 'end', undefined, ['Missing']))
      .toThrow('Группа не найдена: Missing');
  });

  it('rejects a subscription URL without an HTTP scheme', () => {
    expect(() => createMihomoProviderYaml({
      name: 'subscription_1', url: 'sub.example.net/list', interval: 43200,
      healthCheckEnabled: false, healthCheckUrl: '', healthCheckInterval: 300, expectedStatus: 204,
      headersEnabled: false, userAgent: '', hwid: '', udp: true,
      filtersEnabled: false, filter: '', excludeFilter: '', excludeType: '',
    })).toThrow(/http:\/\/ или https:\/\//i);
  });

  it('replaces a selected provider in place and preserves its name', () => {
    const result = insertMihomoProvider(
      'mode: rule\nproxy-providers:\n  current:\n    type: http\n    url: https://old.example/sub\n    interval: 43200\n  keep:\n    type: http\n    url: https://keep.example/sub\n    interval: 43200\n',
      provider('subscription_2', 'https://new.example/sub'),
      'replace',
      'current',
    );
    const config = parse(result) as { 'proxy-providers': Record<string, { url: string }> };
    expect(Object.keys(config['proxy-providers'])).toEqual(['current', 'keep']);
    expect(config['proxy-providers'].current?.url).toBe('https://new.example/sub');
  });

  it('keeps replacement groups attached to the preserved provider name', () => {
    const result = insertMihomoProvider(
      'proxy-providers:\n  current:\n    type: http\n    url: https://old.example/sub\n    interval: 43200\nproxy-groups:\n  - name: Select\n    type: select\n    use: [current]\n',
      provider('generated_name', 'https://new.example/sub'),
      'replace',
      'current',
      ['Select'],
    );
    const config = parse(result) as { 'proxy-groups': Array<{ use: string[] }> };
    expect(config['proxy-groups'][0]?.use).toEqual(['current']);
    expect(config['proxy-groups'][0]?.use).not.toContain('generated_name');
  });

  it('rejects a duplicate provider name instead of overwriting data', () => {
    expect(() => insertMihomoProvider(
      'proxy-providers:\n  current:\n    type: http\n    url: https://old.example/sub\n    interval: 43200\n',
      provider('current', 'https://new.example/sub'),
      'end',
    )).toThrow(/уже существует/i);
  });
});
