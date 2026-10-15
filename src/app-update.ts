export interface AppRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: Array<{ name: string }>;
}

function validateReleaseList(value: unknown): AppRelease[] {
  if (!Array.isArray(value)) throw new Error('GitHub вернул некорректный список версий.');
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const release = item as Partial<AppRelease>;
    return typeof release.tag_name === 'string' && versionParts(release.tag_name) !== null
      && (typeof release.name === 'string' || release.name === null)
      && (release.published_at === undefined || typeof release.published_at === 'string' || release.published_at === null)
      && (release.body === undefined || typeof release.body === 'string' || release.body === null)
      && typeof release.html_url === 'string' && release.prerelease === false && release.draft === false
      && Array.isArray(release.assets)
      && release.assets.every((asset) => asset && typeof asset.name === 'string')
      && release.assets.some((asset) => asset.name === 'xkeen-ui-linux-aarch64.tar.gz')
      && release.assets.some((asset) => asset.name === 'SHA256SUMS')
      && release.html_url === `https://github.com/rangerxxyy/XKeen-UI/releases/tag/${release.tag_name}`;
  }).slice(0, 20) as AppRelease[];
}

export async function listAppReleases(signal?: AbortSignal): Promise<AppRelease[]> {
  try {
    const response = await fetch('https://api.github.com/repos/rangerxxyy/XKeen-UI/releases?per_page=20', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (response.status === 403 || response.status === 429) return listAppReleasesFromFeed(signal);
    if (!response.ok) throw new Error(`Проверка списка релизов вернула HTTP ${response.status}.`);
    const length = Number(response.headers.get('Content-Length') || 0);
    if (length > 1024 * 1024) throw new Error('Список релизов GitHub слишком большой.');
    return validateReleaseList(await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TypeError) return listAppReleasesFromFeed(signal);
    throw error;
  }
}

async function listAppReleasesFromFeed(signal?: AbortSignal): Promise<AppRelease[]> {
  const response = await fetch('/api/v1/app/releases', {
    headers: { Accept: 'application/atom+xml' },
    signal: signal ?? AbortSignal.timeout(16_000),
  });
  if (!response.ok) throw new Error('Список релизов GitHub временно недоступен.');
  const feed = await response.text();
  if (feed.length > 1024 * 1024) throw new Error('Список релизов GitHub слишком большой.');
  const xml = new DOMParser().parseFromString(feed, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Не удалось прочитать список релизов GitHub.');
  const entries = Array.from(xml.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'entry'));
  const releases = entries.map((entry) => {
    const value = (name: string) => entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom', name)[0]?.textContent ?? '';
    const link = entry.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'link')[0]?.getAttribute('href') ?? '';
    const tag = link.match(/^https:\/\/github\.com\/rangerxxyy\/XKeen-UI\/releases\/tag\/(v\d+\.\d+\.\d+)$/)?.[1] ?? '';
    const html = value('content').replace(/<li[^>]*>/gi, '- ').replace(/<\/(?:h[1-6]|p|li|ul)>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n');
    const body = new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
    return {
      tag_name: tag,
      name: value('title'),
      html_url: link,
      published_at: value('updated'),
      body,
      prerelease: false,
      draft: false,
      assets: [{ name: 'xkeen-ui-linux-aarch64.tar.gz' }, { name: 'SHA256SUMS' }],
    };
  });
  return validateReleaseList(releases);
}

function versionParts(value: string): number[] | null {
  const match = value.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(latest: string, installed: string): boolean {
  const a = versionParts(latest);
  const b = versionParts(installed);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export async function checkAppUpdate(installedVersion: string, signal?: AbortSignal): Promise<AppRelease | null> {
  const releases = await listAppReleases(signal);
  const release = releases[0];
  if (!release) throw new Error('Опубликованных стабильных сборок с ARM64-пакетом пока нет.');
  return isNewerVersion(release.tag_name, installedVersion) ? release : null;
}
