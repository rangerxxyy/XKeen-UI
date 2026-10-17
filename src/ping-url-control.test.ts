import { describe, expect, it } from 'vitest';
import { renderPingUrlControl } from './ping-url-control';

describe('ping URL presets', () => {
  it('offers popular endpoints while keeping the editable preference input', () => {
    const html = renderPingUrlControl('www.gstatic.com/generate_204');
    expect(html).toContain('data-pref="pingUrl"');
    expect(html).toContain('aria-label="Адрес ping"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('Google');
    expect(html).toContain('Cloudflare');
    expect(html).toContain('Android');
    expect(html).toContain('Microsoft');
    expect(html).toContain('Apple');
    expect(html).toContain('data-ping-url="cp.cloudflare.com/generate_204"');
    expect(html).toContain('value="www.gstatic.com/generate_204"');
  });
});
