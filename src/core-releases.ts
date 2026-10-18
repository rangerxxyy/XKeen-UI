import { getUpdateProxies, installCoreRelease } from './api';
import { confirmInApp } from './confirm-dialog';
import { bindDialogMotion } from './dialog-motion';

type CoreName = 'xray' | 'mihomo';

type GitHubAsset = {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
};

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  body?: string | null;
  assets: GitHubAsset[];
};

// GitHub release objects include markdown notes. Keep the payload bounded, but
// request a small page so popular forks do not exceed the limit unnecessarily.
const RESPONSE_LIMIT = 2 * 1024 * 1024;

export function normalizeCoreRepository(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('github.com/') ? `https://${trimmed}` : trimmed;
  const authority = normalized.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (authority?.includes(':')) {
    throw new Error('В ссылке на репозиторий не должно быть порта, параметров или дополнительных путей.');
  }
  const url = new URL(normalized);
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

export function isCoreRelease(value: unknown): value is GitHubRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as Partial<GitHubRelease>;
  return typeof release.tag_name === 'string'
    && (typeof release.name === 'string' || release.name === null)
    && typeof release.html_url === 'string'
    && (typeof release.published_at === 'string' || release.published_at === null)
    && typeof release.prerelease === 'boolean'
    && typeof release.draft === 'boolean'
    && (release.body === undefined || release.body === null || (typeof release.body === 'string' && release.body.length <= 50_000))
    && Array.isArray(release.assets)
    && release.assets.every((asset) => asset && typeof asset.name === 'string'
      && typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size >= 0
      && typeof asset.browser_download_url === 'string'
      && (asset.digest === undefined || asset.digest === null || typeof asset.digest === 'string'));
}

export function findCompatibleCoreAsset(core: CoreName, assets: GitHubAsset[]): GitHubAsset | undefined {
  if (core === 'xray') {
    return assets.find((asset) => /linux-arm64-v8a\.zip$/i.test(asset.name));
  }
  return assets.find((asset) => /linux-arm64.*\.gz$/i.test(asset.name)
    && !/\.sha256(?:sum)?$/i.test(asset.name));
}

export function isStableCompatibleRelease(core: CoreName, release: GitHubRelease): boolean {
  return !release.draft && !release.prerelease && Boolean(findCompatibleCoreAsset(core, release.assets));
}

export function isDisplayableCoreRelease(core: CoreName, release: GitHubRelease): boolean {
  if (core === 'xray') {
    return !release.draft && Boolean(findCompatibleCoreAsset(core, release.assets));
  }
  return isStableCompatibleRelease(core, release);
}

export function safeCoreReleaseLink(value: string): string | undefined {
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

function renderReleaseList(target: HTMLElement, core: CoreName, releases: GitHubRelease[], keepBackup: () => boolean = () => true): void {
  const list = element('div', 'core-release-list');
  const visible = releases.filter((release) => isDisplayableCoreRelease(core, release));
  if (visible.length) {
    const picker = element('label', 'core-release-picker');
    picker.append(element('span', undefined, 'Версия'));
    const select = element('select', 'editor-select');
    select.setAttribute('aria-label', `Выберите версию ${core}`);
    for (const release of visible) {
      const option = document.createElement('option');
      option.value = release.tag_name;
      option.textContent = `${release.name || release.tag_name} · ${release.tag_name}`;
      select.append(option);
    }
    select.addEventListener('change', () => {
      list.querySelector<HTMLElement>(`[data-release-tag="${CSS.escape(select.value)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    picker.append(select);
    list.append(picker);
  }
  if (!visible.length) {
    list.append(element('p', 'core-release-empty', 'Совместимого релиза с архивом для ARM64 пока нет.'));
  }
  for (const release of visible) {
    const card = element('article', 'core-release-card');
    card.dataset.releaseTag = release.tag_name;
    const heading = element('div', 'core-release-heading');
    const title = element('strong', undefined, release.name || release.tag_name);
    const badges = element('span', 'core-release-badges');
    badges.append(element('span', `core-release-badge${release.prerelease ? ' is-preview' : ''}`, release.prerelease ? 'Pre-Release' : 'Stable'));
    const asset = findCompatibleCoreAsset(core, release.assets);
    badges.append(element('span', `core-release-badge${asset ? ' is-ready' : ' is-muted'}`, asset ? 'ARM64' : 'Нет архива ARM64'));
    heading.append(title, badges);
    card.append(heading);

    const published = release.published_at
      ? new Date(release.published_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'дата не указана';
    card.append(element('p', 'core-release-meta', `${release.tag_name} · ${published} · ${release.assets.length} файлов`));
    if (release.body?.trim()) {
      const notes = document.createElement('details');
      notes.className = 'core-release-changelog';
      if (release === visible[0]) notes.open = true;
      notes.append(element('summary', undefined, 'Что изменилось'));
      const text = element('pre');
      text.textContent = release.body.slice(0, 12_000);
      notes.append(text);
      card.append(notes);
    }
    if (asset) {
      const assetRow = element('div', 'core-release-asset');
      assetRow.append(element('code', undefined, asset.name));
      assetRow.append(element('span', undefined, sizeLabel(asset.size)));
      card.append(assetRow);
      const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
      if (digest && asset.size > 0 && asset.size <= 32 * 1024 * 1024) {
        const install = element('button', 'editor-button editor-button-primary', 'Установить / обновить');
        install.type = 'button';
        install.addEventListener('click', () => void installRelease(core, release.tag_name, asset.name, digest, install, list, keepBackup));
        card.append(install);
      } else {
        card.append(element('p', 'core-release-note', 'GitHub не предоставил проверяемый SHA-256 или архив превышает 32 MiB; установка недоступна.'));
      }
    }
    const link = safeCoreReleaseLink(release.html_url);
    if (link) {
      const open = element('a', 'core-release-link', 'Открыть релиз на GitHub ↗');
      open.href = link;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      card.append(open);
    }
    list.append(card);
  }
  const note = element('p', 'core-release-note', 'Перед заменой активного ядра панель проверяет конфигурацию. Для защиты от сбоя создаётся временная копия; при включённой настройке прежний бинарник также сохраняется для ручного отката.');
  target.replaceChildren(list, ...(visible.length ? [note] : []));
}

export async function openCoreReleaseDialog(
  core: CoreName,
  repository: () => Promise<string>,
  currentVersion?: string | null,
  keepBackup: () => boolean = () => true,
): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal core-release-dialog';
  const title = core === 'mihomo' ? 'Обновление Mihomo' : 'Обновление Xray';
  dialog.innerHTML = `<form method="dialog" class="modal-panel core-release-dialog-panel"><div class="modal-heading"><span class="modal-icon">⇩</span><h2>${title}</h2><button class="icon-button" aria-label="Закрыть">×</button></div><div class="core-release-dialog-source"><span id="core-release-repository">Источник загружается…</span><span class="core-release-github">GitHub</span></div><p class="modal-note" id="core-release-dialog-status" aria-live="polite">Загружаем совместимые ARM64-релизы…</p><div id="core-release-dialog-list" class="core-release-dialog-list"></div><button class="button button-primary modal-close" type="submit">Готово</button></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  bindDialogMotion(dialog);
  dialog.showModal();

  const status = dialog.querySelector<HTMLElement>('#core-release-dialog-status')!;
  const source = dialog.querySelector<HTMLElement>('#core-release-repository')!;
  const target = dialog.querySelector<HTMLElement>('#core-release-dialog-list')!;
  try {
    const configuredRepository = await repository();
    const repo = normalizeCoreRepository(configuredRepository);
    source.textContent = repo;
    const releases = await fetchConfiguredCoreReleases(configuredRepository);
    const visible = releases.filter((release) => isDisplayableCoreRelease(core, release));
    status.textContent = `${visible.length} совместимых ARM64-релизов${currentVersion ? ` · установлена ${currentVersion}` : ''}`;
    renderReleaseList(target, core, releases, keepBackup);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Не удалось загрузить релизы.';
  }
}

async function installRelease(core: CoreName, tag: string, asset: string, sha256: string, button: HTMLButtonElement, list: HTMLElement, keepBackup: () => boolean): Promise<void> {
  const keep = keepBackup();
  const confirmed = await confirmInApp(
    `Установить ${core} ${tag}?`,
    `Архив проверится по SHA-256. Активная конфигурация будет проверена, а сервис кратко перезапустится. ${keep ? 'Прежний бинарник сохранится для отката.' : 'Постоянная копия отключена; временная копия останется только на время обновления для автоматического отката при сбое.'}`,
    'Установить',
  );
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = 'Загрузка и установка…';
  const feedback = element('div', 'core-release-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.setAttribute('aria-label', 'Загрузка и установка ядра');
  feedback.append(progress, element('span', undefined, `Загружаем и проверяем ${asset}.`));
  list.append(feedback);
  try {
    const result = await installCoreRelease({ core, tag, asset, sha256, keepBackup: keep });
    feedback.className = 'core-release-feedback';
    feedback.textContent = `${result.detail}${result.backup ? ` · резервная копия: ${result.backup}` : ''}`;
    window.dispatchEvent(new CustomEvent('xkeen-core-updated'));
  } catch (error) {
    feedback.className = 'core-release-feedback is-error';
    feedback.textContent = error instanceof Error ? error.message : `Не удалось установить ${core}.`;
  } finally {
    button.disabled = false;
    button.textContent = 'Установить / обновить';
  }
}

export async function fetchCoreReleases(repository: string, proxies: string[] = []): Promise<GitHubRelease[]> {
  const repo = normalizeCoreRepository(repository);
  const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=5`;
  const urls = [apiUrl, ...proxies.flatMap((proxy) => {
    try {
      const parsed = new URL(proxy);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return [];
      return [`${proxy.replace(/\/+$/, '')}/${apiUrl}`];
    } catch { return []; }
  })];
  let response: Response | undefined;
  let lastNetworkError: unknown;
  for (const url of urls) {
    try {
      const candidate = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(12_000),
  });
      if (candidate.status === 404) throw new Error('GitHub не нашёл такой репозиторий или он закрытый.');
      if ((candidate.status === 403 || candidate.status === 429 || candidate.status >= 500) && url !== urls.at(-1)) continue;
      response = candidate;
      break;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GitHub не нашёл')) throw error;
      lastNetworkError = error;
    }
  }
  if (!response) throw new Error(lastNetworkError instanceof Error ? 'Не удалось получить релизы GitHub напрямую или через настроенные прокси.' : 'GitHub не вернул список релизов.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub ограничил запросы. Проверьте настроенные прокси и повторите попытку позже.');
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
  if (!Array.isArray(payload) || !payload.every(isCoreRelease)) throw new Error('GitHub вернул данные релизов неожиданного формата.');
  return payload;
}

export async function fetchConfiguredCoreReleases(repository: string): Promise<GitHubRelease[]> {
  const proxies = await getUpdateProxies().then(({ proxies: values }) => values).catch(() => []);
  return fetchCoreReleases(repository, proxies);
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
        const releases = await fetchConfiguredCoreReleases(input.value);
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
