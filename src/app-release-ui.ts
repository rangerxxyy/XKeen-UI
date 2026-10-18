function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

export function renderAppVersionChip(version: string): string {
  const normalized = version.replace(/^v/i, '');
  const label = escapeHtml(`Обновить XKeen UI, версия v${normalized}`);
  return `<button class="version-chip app-version-button" id="app-version" type="button" title="${label}" aria-label="${label}"><span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 3.75h8l4 4v8.5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 4 16.25z"/><path d="M12 4v4h4M7 12h6M7 15h4"/></svg></span><b id="app-version-label">v${escapeHtml(normalized)}</b></button>`;
}

export function renderAppReleaseActions(): string {
  return '<div class="app-release-actions"><button id="app-release-install" class="editor-button editor-button-primary" type="button" disabled>Установить</button></div>';
}
