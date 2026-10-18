import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCoreReleases,
  findCompatibleCoreAsset,
  isCoreRelease,
  isDisplayableCoreRelease,
  isStableCompatibleRelease,
  normalizeCoreRepository,
  safeCoreReleaseLink,
} from './core-releases';

const asset = (name: string, size = 1024) => ({
  name,
  size,
  browser_download_url: `https://github.com/owner/repo/releases/download/v1/${encodeURIComponent(name)}`,
});

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.3',
  name: 'Stable release',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
  published_at: '2026-10-10T12:00:00Z',
  prerelease: false,
  draft: false,
  assets: [asset('Xray-linux-arm64-v8a.zip')],
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('normalizeCoreRepository', () => {
  it.each([
    ['https://github.com/XTLS/Xray-core', 'XTLS/Xray-core'],
    ['github.com/MetaCubeX/mihomo/', 'MetaCubeX/mihomo'],
    ['https://github.com/owner/repo.git/', 'owner/repo'],
    ['https://github.com/Owner.Name/repo_name-1', 'Owner.Name/repo_name-1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCoreRepository(input)).toBe(expected);
  });

  it.each([
    'http://github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://user:password@github.com/owner/repo',
    'https://github.com:443/owner/repo',
    'https://github.com/owner/repo/releases',
    'https://github.com/owner/repo?tab=releases',
    'https://github.com/owner/repo#v1.2.3',
    'https://github.com/../repo',
    'https://github.com/owner//repo',
    'not a URL',
    '',
  ])('rejects an unsafe or non-root repository URL: %s', (input) => {
    expect(() => normalizeCoreRepository(input)).toThrow();
  });
});

describe('findCompatibleCoreAsset', () => {
  it('selects only the expected Xray ARM64 archive', () => {
    const candidates = [
      asset('Xray-linux-32.zip'),
      asset('Xray-linux-arm64-v8a.zip.sha256'),
      asset('Xray-linux-arm64-v8a.zip'),
      asset('Xray-linux-arm64.zip'),
    ];
    expect(findCompatibleCoreAsset('xray', candidates)?.name).toBe('Xray-linux-arm64-v8a.zip');
  });

  it('selects an ARM64 Mihomo gzip archive but never a checksum', () => {
    const candidates = [
      asset('mihomo-linux-amd64-v1.19.0.gz'),
      asset('mihomo-linux-arm64-v1.19.0.gz.sha256'),
      asset('mihomo-linux-arm64-v1.19.0.gz'),
    ];
    expect(findCompatibleCoreAsset('mihomo', candidates)?.name).toBe('mihomo-linux-arm64-v1.19.0.gz');
  });

  it('returns no asset for an unsupported target', () => {
    expect(findCompatibleCoreAsset('xray', [asset('Xray-linux-arm64.zip')])).toBeUndefined();
    expect(findCompatibleCoreAsset('mihomo', [asset('mihomo-linux-mipsle-v1.19.0.gz')])).toBeUndefined();
  });
});

describe('stable core releases', () => {
  it('allows only published stable releases that include a supported ARM64 binary', () => {
    expect(isStableCompatibleRelease('xray', release())).toBe(true);
    expect(isStableCompatibleRelease('xray', release({ prerelease: true }))).toBe(false);
    expect(isStableCompatibleRelease('xray', release({ assets: [asset('Xray-linux-arm64.zip')] }))).toBe(false);
    expect(isStableCompatibleRelease('mihomo', release({ assets: [asset('prizrak-core-linux-arm64-v1.19.32-r4.gz')] }))).toBe(true);
  });
});

describe('displayable core releases', () => {
  it('accepts release notes only as bounded text content', () => {
    expect(isCoreRelease({ ...release(), body: 'Changes\n- Fixes' })).toBe(true);
    expect(isCoreRelease({ ...release(), body: 42 })).toBe(false);
  });
  it('includes compatible Xray prereleases with an ARM64 binary like the reference updater', () => {
    expect(isDisplayableCoreRelease('xray', release({ prerelease: true }))).toBe(true);
  });

  it('keeps Mihomo prereleases out of the normal update list', () => {
    expect(isDisplayableCoreRelease('mihomo', release({
      prerelease: true,
      assets: [asset('prizrak-core-linux-arm64-v1.19.32-r4.gz')],
    }))).toBe(false);
  });

  it('does not show prereleases without a supported ARM64 archive', () => {
    expect(isDisplayableCoreRelease('xray', release({ prerelease: true, assets: [] }))).toBe(false);
  });
});

describe('safeCoreReleaseLink', () => {
  it('accepts a normal HTTPS GitHub release URL', () => {
    expect(safeCoreReleaseLink('https://github.com/owner/repo/releases/tag/v1.2.3'))
      .toBe('https://github.com/owner/repo/releases/tag/v1.2.3');
  });

  it.each([
    'javascript:alert(1)',
    'http://github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://user@github.com/owner/repo',
    'malformed',
  ])('rejects an unsafe outbound release link: %s', (url) => {
    expect(safeCoreReleaseLink(url)).toBeUndefined();
  });
});

describe('isCoreRelease', () => {
  it('accepts a valid release and validates every asset field', () => {
    expect(isCoreRelease(release())).toBe(true);
    expect(isCoreRelease(release({ assets: [asset('core.gz', Number.NaN)] }))).toBe(false);
  });

  it.each([
    null,
    'release',
    [],
    release({ tag_name: 123 }),
    release({ name: undefined }),
    release({ html_url: null }),
    release({ published_at: 123 }),
    release({ prerelease: 'false' }),
    release({ draft: 0 }),
    release({ assets: {} }),
    release({ assets: [{ ...asset('core.gz'), size: '1024' }] }),
    release({ assets: [{ name: 'core.gz' }] }),
  ])('rejects malformed release data: %j', (value) => {
    expect(isCoreRelease(value)).toBe(false);
  });
});

describe('fetchCoreReleases', () => {
  it('uses the validated repo path and requests only public release metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([release()]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCoreReleases('https://github.com/owner/repo.git'))
      .resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases?per_page=5',
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
    );
  });

  it('tries configured GitHub mirrors when the direct release API is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify([release()]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCoreReleases('https://github.com/owner/repo', ['https://gh-proxy.com']))
      .resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/repo/releases?per_page=5',
      'https://gh-proxy.com/https://api.github.com/repos/owner/repo/releases?per_page=5',
    ]);
  });

  it('rejects the repository before making any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCoreReleases('https://attacker.invalid/owner/repo')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([404, 403, 429, 500])('turns HTTP %i into a visible error', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(fetchCoreReleases('https://github.com/owner/repo')).rejects.toThrow();
  });

  it('rejects an oversized response from its declared content length without reading it', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() {},
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Length': String(512 * 1024 + 1) },
    });
    const cancel = vi.spyOn(response.body!, 'cancel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(fetchCoreReleases('https://github.com/owner/repo')).rejects.toThrow(/размер/);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('enforces the response byte limit when content length is omitted', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(fetchCoreReleases('https://github.com/owner/repo')).rejects.toThrow(/размер/);
  });

  it.each([
    'not json',
    '{}',
    JSON.stringify([release({ assets: [{ name: 'invalid' }] })]),
  ])('rejects invalid JSON or unexpected response structure', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(fetchCoreReleases('https://github.com/owner/repo')).rejects.toThrow();
  });

  it('returns an empty release list without inventing a result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(fetchCoreReleases('https://github.com/owner/repo')).resolves.toEqual([]);
  });
});
