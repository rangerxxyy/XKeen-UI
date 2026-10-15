import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAppUpdate, isNewerVersion, listAppReleases } from './app-update';

afterEach(() => vi.unstubAllGlobals());

describe('XKeen UI release check', () => {
  it('loads recent stable ARM64 releases for the version menu', async () => {
    const payload = [
      { tag_name: 'v0.4.0', name: 'v0.4.0', html_url: 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.4.0', prerelease: false, draft: false, assets: [{ name: 'xkeen-ui-linux-aarch64.tar.gz' }, { name: 'SHA256SUMS' }] },
      { tag_name: 'v0.4.1-rc1', name: 'preview', html_url: 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.4.1-rc1', prerelease: true, draft: false, assets: [{ name: 'xkeen-ui-linux-aarch64.tar.gz' }, { name: 'SHA256SUMS' }] },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listAppReleases()).resolves.toMatchObject([{ tag_name: 'v0.4.0' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/rangerxxyy/XKeen-UI/releases?per_page=20',
      expect.objectContaining({ credentials: 'omit', cache: 'no-store' }),
    );
  });

  it('compares semantic versions rather than lexically', () => {
    expect(isNewerVersion('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('v0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('v0.1.9', '0.2.0')).toBe(false);
    expect(isNewerVersion('main', '0.2.0')).toBe(false);
  });

  it('reports only a published stable release with the expected ARM64 package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      tag_name: 'v0.3.0', name: 'v0.3.0', html_url: 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.3.0',
      prerelease: false, draft: false, assets: [{ name: 'xkeen-ui-linux-aarch64.tar.gz' }, { name: 'SHA256SUMS' }],
    }]), { headers: { 'Content-Type': 'application/json' } })));
    await expect(checkAppUpdate('0.2.0')).resolves.toMatchObject({ tag_name: 'v0.3.0' });
  });

  it('does not call a prerelease or incomplete release an available update', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      tag_name: 'v0.3.0', name: 'v0.3.0', html_url: 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.3.0',
      prerelease: false, draft: false, assets: [{ name: 'source.zip' }],
    }]), { headers: { 'Content-Type': 'application/json' } })));
    await expect(checkAppUpdate('0.2.0')).rejects.toThrow('с ARM64-пакетом пока нет');
  });

  it('reports that no stable release exists when GitHub latest returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(checkAppUpdate('0.2.1')).rejects.toThrow('HTTP 404');
  });

  it('does not advertise the installed version as an update', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      tag_name: 'v0.2.1', name: 'v0.2.1', html_url: 'https://github.com/rangerxxyy/XKeen-UI/releases/tag/v0.2.1',
      prerelease: false, draft: false, assets: [{ name: 'xkeen-ui-linux-aarch64.tar.gz' }, { name: 'SHA256SUMS' }],
    }]), { headers: { 'Content-Type': 'application/json' } })));
    await expect(checkAppUpdate('0.2.1')).resolves.toBeNull();
  });
});
