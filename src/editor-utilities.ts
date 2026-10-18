import { renderUsefulLinksMenu } from './useful-links';

export function renderEditorUtilitiesMenu(): string {
  return `<div class="editor-utilities-menu" role="menu" aria-label="Утилиты конфигурации"><button type="button" role="menuitem" id="yaml-add-proxy" data-mihomo-only><span class="utility-icon" aria-hidden="true">↗</span><span>Добавить прокси</span></button><button type="button" role="menuitem" id="yaml-template" data-structured-only><span class="utility-icon" aria-hidden="true">▤</span><span>Шаблон конфигурации</span></button><button type="button" role="menuitem" id="yaml-import-amnezia"><span class="utility-icon" aria-hidden="true">⇧</span><span>Импорт AmneziaWG</span></button><div class="editor-utilities-divider" role="separator"></div>${renderUsefulLinksMenu()}</div>`;
}
