export interface AppRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: Array<{ name: string }>;
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

function validateRelease(value: unknown): AppRelease {
  if (!value || typeof value !== 'object') throw new Error('GitHub вернул некорректные сведения о версии.');
  const release = value as Partial<AppRelease>;
  if (typeof release.tag_name !== 'string' || !versionParts(release.tag_name)
    || !(typeof release.name === 'string' || release.name === null)
    || typeof release.html_url !== 'string' || typeof release.prerelease !== 'boolean'
    || typeof release.draft !== 'boolean' || !Array.isArray(release.assets)
    || !release.assets.every((asset) => asset && typeof asset.name === 'string')) {
    throw new Error('GitHub вернул данные релиза неожиданного формата.');
  }
  const url = new URL(release.html_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== `/rangerxxyy/XKeen-UI/releases/tag/${release.tag_name}`) {
    throw new Error('Ссылка на релиз не прошла проверку.');
  }
  if (release.draft || release.prerelease) throw new Error('GitHub latest указывает на неопубликованный или предварительный релиз.');
  const assetNames = new Set(release.assets.map((asset) => asset.name));
  if (!assetNames.has('xkeen-ui-linux-aarch64.tar.gz') || !assetNames.has('SHA256SUMS')) {
    throw new Error('В релизе нет полного ARM64-пакета с контрольной суммой.');
  }
  return release as AppRelease;
}

export async function checkAppUpdate(installedVersion: string, signal?: AbortSignal): Promise<AppRelease | null> {
  const response = await fetch('https://api.github.com/repos/rangerxxyy/XKeen-UI/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new Error('Опубликованной стабильной версии пока нет.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub ограничил запросы проверки обновлений; повторите позже.');
  if (!response.ok) throw new Error(`Проверка обновления вернула HTTP ${response.status}.`);
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > 64 * 1024) throw new Error('Ответ GitHub слишком большой.');
  const release = validateRelease(await response.json());
  return isNewerVersion(release.tag_name, installedVersion) ? release : null;
}
