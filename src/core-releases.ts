type CoreName = 'xray' | 'mihomo';

type GitHubAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubAsset[];
};

const RESPONSE_LIMIT = 512 * 1024;

function repoPath(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed.startsWith('github.com/') ? `https://${trimmed}` : trimmed);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) {
    throw new Error('Укажите корень публичного GitHub-репозитория.');
  }
  if (url.port || url.search || url.hash || url.pathname.includes('//')) {
    throw new Error('В ссылке на репозиторий не должно быть порта, параметров или дополнительных путей.');
  }
  const parts = url.pathname.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
  const repository = parts[1];
  if (parts.length === 2 && repository?.endsWith('.git')) parts[1] = repository.slice(0, -4);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part) || part === '.' || part === '..')) {
    throw new Error('Нужен URL вида github.com/владелец/репозиторий.');
  }
  return `${parts[0]}/${parts[1]}`;
}

function isRelease(value: unknown): value is GitHubRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as Partial<GitHubRelease>;
  return typeof release.tag_name === 'string'
    && (typeof release.name === 'string' || release.name === null)
    && typeof release.html_url === 'string'
    && (typeof release.published_at === 'string' || release.published_at === null)
    && typeof release.prerelease === 'boolean'
    && typeof release.draft === 'boolean'
    && Array.isArray(release.assets)
    && release.assets.every((asset) => asset && typeof asset.name === 'string'
      && typeof asset.size === 'number' && typeof asset.browser_download_url === 'string');
}

function compatibleAsset(core: CoreName, assets: GitHubAsset[]): GitHubAsset | undefined {
  if (core === 'xray') {
    return assets.find((asset) => /linux-arm64-v8a\.zip$/i.test(asset.name));
  }
  return assets.find((asset) => /linux-arm64.*\.gz$/i.test(asset.name)
    && !/\.sha256(?:sum)?$/i.test(asset.name));
}

function safeGitHubLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Malformed URLs from the public API are ignored.
  }
  return undefined;
}

function sizeLabel(size: number): string {
  if (!Number.isFinite(size) || size < 0) return 'размер неизвестен';
  return new Intl.NumberFormat('ru-RU', { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 })
    .format(size / 1_000_000);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderReleaseList(target: HTMLElement, core: CoreName, releases: GitHubRelease[]): void {
  const list = element('div', 'core-release-list');
  const visible = releases.filter((release) => !release.draft);
  if (!visible.length) {
    list.append(element('p', 'core-release-empty', 'В репозитории нет опубликованных релизов.'));
  }
  for (const release of visible) {
    const card = element('article', 'core-release-card');
    const heading = element('div', 'core-release-heading');
    const title = element('strong', undefined, release.name || release.tag_name);
    const badges = element('span', 'core-release-badges');
    badges.append(element('span', `core-release-badge${release.prerelease ? ' is-preview' : ''}`, release.prerelease ? 'Предварительная' : 'Стабильная'));
    const asset = compatibleAsset(core, release.assets);
    badges.append(element('span', `core-release-badge${asset ? ' is-ready' : ' is-muted'}`, asset ? 'ARM64' : 'Нет архива ARM64'));
    heading.append(title, badges);
    card.append(heading);

    const published = release.published_at
      ? new Date(release.published_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'дата не указана';
    card.append(element('p', 'core-release-meta', `${release.tag_name} · ${published} · ${release.assets.length} файлов`));
    if (asset) {
      const assetRow = element('div', 'core-release-asset');
      assetRow.append(element('code', undefined, asset.name));
      assetRow.append(element('span', undefined, sizeLabel(asset.size)));
      card.append(assetRow);
    }
    const link = safeGitHubLink(release.html_url);
    if (link) {
      const open = element('a', 'core-release-link', 'Открыть релиз на GitHub ↗');
      open.href = link;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      card.append(open);
    }
    list.append(card);
  }
  const note = element('p', 'core-release-note', 'Просмотр релизов ничего не устанавливает. Установка и обновление ядер появятся после реализации проверки совместимости и безопасного отката.');
  target.replaceChildren(list, note);
}

async function fetchReleases(repo: string): Promise<GitHubRelease[]> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=1`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) throw new Error('GitHub не нашёл такой репозиторий или он закрытый.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub ограничил запросы. Повторите проверку позже.');
  if (!response.ok) throw new Error(`GitHub API вернул HTTP ${response.status}.`);
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > RESPONSE_LIMIT) throw new Error('Ответ со списком релизов превышает допустимый размер.');
  if (!response.body) throw new Error('GitHub вернул пустой ответ.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error('Ответ со списком релизов превышает допустимый размер.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const payload: unknown = JSON.parse(body);
  if (!Array.isArray(payload) || !payload.every(isRelease)) throw new Error('GitHub вернул данные релизов неожиданного формата.');
  return payload;
}

export function bindCoreReleaseChecks(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-core-release]')) {
    button.addEventListener('click', async () => {
      const core = button.dataset.coreRelease;
      if (core !== 'xray' && core !== 'mihomo') return;
      const input = document.querySelector<HTMLInputElement>(`#source-${core}`);
      const target = document.querySelector<HTMLElement>(`#releases-${core}`);
      if (!input || !target) return;
      button.disabled = true;
      button.textContent = 'Проверяем…';
      target.replaceChildren(element('p', 'core-release-feedback', 'Получаем опубликованные релизы из GitHub.'));
      try {
        const repo = repoPath(input.value);
        const releases = await fetchReleases(repo);
        renderReleaseList(target, core, releases);
      } catch (error) {
        target.replaceChildren(element('p', 'core-release-feedback is-error', error instanceof Error ? error.message : 'Не удалось получить релизы.'));
      } finally {
        button.disabled = false;
        button.textContent = 'Проверить релизы';
      }
    });
  }
}
