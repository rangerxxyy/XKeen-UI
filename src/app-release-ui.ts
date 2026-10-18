function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

export function renderAppVersionChip(version: string, updateAvailable = false): string {
  const normalized = version.replace(/^v/i, '');
  const label = escapeHtml(updateAvailable ? `Доступно обновление XKeen UI ${normalized}` : `Обновить XKeen UI, версия v${normalized}`);
  return `<button class="version-chip app-version-button${updateAvailable ? ' is-update-available' : ''}" id="app-version" type="button" title="${label}" aria-label="${label}"><span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v4h16v-4"/></svg></span><b id="app-version-label">v${escapeHtml(normalized)}</b></button>`;
}

export function renderAppUpdateNotice(version: string, releaseUrl: string): string {
  let safeUrl = '';
  try {
    const url = new URL(releaseUrl);
    if (url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/rangerxxyy/XKeen-UI/releases/tag/')) safeUrl = url.href;
  } catch {
    // A missing or malformed release URL simply hides the external action.
  }
  return `<article class="toast toast-info update-toast" role="status"><button class="update-toast-copy" type="button" data-open-app-update><span class="update-toast-icon" aria-hidden="true">✓</span><span class="update-toast-text"><strong>Доступно обновление</strong><span>Доступна новая версия XKeen UI ${escapeHtml(version)}</span></span></button><span class="update-toast-actions">${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть выпуск на GitHub" title="GitHub" class="update-toast-link"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.93c.46.08.63-.2.63-.45v-1.6c-2.56.56-3.1-1.08-3.1-1.08-.42-1.06-1.02-1.34-1.02-1.34-.84-.58.06-.57.06-.57.93.07 1.42.95 1.42.95.83 1.42 2.18 1.01 2.71.77.08-.6.32-1.01.59-1.24-2.05-.23-4.2-1.02-4.2-4.56 0-1.01.36-1.83.95-2.47-.1-.23-.41-1.17.09-2.44 0 0 .78-.25 2.53.94a8.77 8.77 0 0 1 4.61 0c1.76-1.19 2.53-.94 2.53-.94.5 1.27.19 2.21.09 2.44.59.64.95 1.46.95 2.47 0 3.55-2.15 4.33-4.21 4.56.33.29.62.84.62 1.7v2.51c0 .25.17.54.64.45A9.2 9.2 0 0 0 12 2.8Z"/></svg></a>` : ''}<button class="update-toast-dismiss" type="button" data-dismiss-app-update aria-label="Закрыть уведомление">×</button></span></article>`;
}

export function renderAppReleaseActions(): string {
  return '<div class="app-release-actions"><button id="app-release-install" class="editor-button editor-button-primary" type="button" disabled>Установить</button></div>';
}
