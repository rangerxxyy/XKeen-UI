import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { appendMihomoProxy } from './proxy-import';

describe('Mihomo proxy import', () => {
  it('appends a generated proxy without dropping existing config keys', () => {
    const result = appendMihomoProxy('mode: rule\nproxies:\n  - name: old\n    type: direct\n', '  - name: \'new\'\n    type: vless\n    server: example.com\n');
    const parsed = parse(result) as { mode: string; proxies: { name: string }[] };
    expect(parsed.mode).toBe('rule');
    expect(parsed.proxies.map(({ name }) => name)).toEqual(['old', 'new']);
  });

  it('creates proxies when the configuration has no proxies section', () => {
    const result = appendMihomoProxy('mode: rule\n', '  - name: \'new\'\n    type: vless\n');
    const parsed = parse(result) as { proxies: { name: string }[] };
    expect(parsed.proxies[0]?.name).toBe('new');
  });
});
