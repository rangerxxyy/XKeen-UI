import { describe, expect, it } from 'vitest';
import { parseProxyProviders, renderProxyProviders } from './proxy-providers-view';

describe('proxy subscriptions view', () => {
  it('lists provider names and their available proxy nodes', () => {
    const providers = parseProxyProviders({ providers: { Main: { vehicleType: 'HTTP', proxies: [{ name: 'Sweden', type: 'VLESS' }] } } });
    expect(providers).toEqual([{ name: 'Main', type: 'HTTP', proxies: [{ name: 'Sweden', type: 'VLESS' }] }]);
    const html = renderProxyProviders(providers, false, null);
    expect(html).toContain('Прокси-подписки');
    expect(html).toContain('Main');
    expect(html).toContain('Sweden');
    expect(html).toContain('1 узел');
  });

  it('renders an empty state and safely escapes untrusted provider names', () => {
    expect(renderProxyProviders([], false, null)).toContain('Провайдеры прокси не найдены');
    const html = renderProxyProviders([{ name: '<img src=x>', type: 'HTTP', proxies: [] }], false, null);
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('rejects malformed runtime data and shows a retry action for errors', () => {
    expect(() => parseProxyProviders({ providers: { bad: { proxies: 'not an array' } } })).toThrow();
    expect(renderProxyProviders([], false, 'runtime unavailable')).toContain('runtime unavailable');
  });
});
