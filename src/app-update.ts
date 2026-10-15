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
  const response = await fetch('https://api.github.com/repos/rangerxxyy/XKeen-UI/releases?per_page=20', {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: signal ?? AbortSignal.timeout(12_000),
  });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub ограничил запросы проверки обновлений; повторите позже.');
  if (!response.ok) throw new Error(`Проверка списка релизов вернула HTTP ${response.status}.`);
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > 1024 * 1024) throw new Error('Список релизов GitHub слишком большой.');
  return validateReleaseList(await response.json());
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
