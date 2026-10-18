import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDnsAutoApply, setDnsAutoApply } from './api';

describe('router DNS boot reapply setting', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the persisted setting from the router', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDnsAutoApply()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dns/auto-apply', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('writes the selected boot reapply mode to the router', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await setDnsAutoApply(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dns/auto-apply', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    }));
  });
});
