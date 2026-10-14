import type { MihomoConnection, MihomoConnections, MihomoSelector } from './api';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let unit = units[0] ?? 'КБ';
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unit}`;
}

function loadState(loading: boolean, error: string | null, noun: string): string {
  if (loading) return `<section class="mihomo-empty"><span class="loading-orbit" aria-hidden="true"></span><strong>Получаем ${noun} из Mihomo</strong><p>Запрашиваем локальный API ядра.</p></section>`;
  if (error) return `<section class="mihomo-empty mihomo-error"><span class="mihomo-error-mark">!</span><strong>Не удалось загрузить ${noun}</strong><p>${escapeHtml(error)}</p><button class="button button-quiet" id="mihomo-retry">Повторить запрос</button></section>`;
  return '';
}

function proxyCard(group: MihomoSelector): string {
  const options = group.options.map((option) => {
    const selected = option.name === group.current;
    const state = option.alive === null ? 'Проверка недоступна' : option.alive ? 'Узел отвечает' : 'Узел не отвечает';
    const delay = option.delay === null ? '—' : `${option.delay} мс`;
    return `<article class="proxy-option ${selected ? 'is-selected' : ''}">
      <div class="proxy-option-top"><span class="proxy-type">${escapeHtml(option.type)}</span>${selected ? '<span class="selected-mark">Выбран</span>' : ''}</div>
      <strong title="${escapeHtml(option.name)}">${escapeHtml(option.name)}</strong>
      <div class="proxy-option-bottom"><span class="proxy-health ${option.alive === true ? 'is-alive' : option.alive === false ? 'is-dead' : ''}" title="${state}"><i></i>${delay}</span>
        ${selected ? '' : `<button class="proxy-select" data-proxy-group="${escapeHtml(group.name)}" data-proxy-name="${escapeHtml(option.name)}">Выбрать</button>`}
      </div>
    </article>`;
  }).join('');
  return `<section class="selector-card"><header class="selector-card-heading"><div><span class="selector-kicker">ГРУППА MIHOMO</span><h2>${escapeHtml(group.name)}</h2></div><span class="selector-current"><small>АКТИВНЫЙ УЗЕЛ</small><strong title="${escapeHtml(group.current ?? 'Не выбран')}">${escapeHtml(group.current ?? 'Не выбран')}</strong></span></header>
    <div class="selector-card-meta"><span>${group.options.length} узлов в группе</span><span class="selector-meta-line"></span><span>Selector</span></div>
    <div class="proxy-options">${options || '<div class="mihomo-inline-empty">В этой группе нет узлов.</div>'}</div>
  </section>`;
}

export function renderSelectors(groups: MihomoSelector[], loading: boolean, error: string | null): string {
  const state = loadState(loading, error, 'группы');
  return `<section class="page-heading mihomo-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> MIHOMO · РЕАЛЬНЫЕ ДАННЫЕ</div><h1>Селекторы</h1><p>Выбор узла изменит активный маршрут для группы Mihomo.</p></div><div class="mihomo-heading-actions"><span class="runtime-badge"><span class="runtime-dot"></span> API ядра</span><button class="button button-quiet" id="mihomo-refresh"><span>↻</span> Обновить</button></div></section>
  ${state || (groups.length === 0 ? '<section class="mihomo-empty"><span class="mihomo-error-mark">◇</span><strong>Группы Selector не найдены</strong><p>API Mihomo ответил, но не вернул выбираемых групп.</p></section>' : `<section class="selector-summary"><div><span class="summary-icon">⇄</span><strong>${groups.length}</strong><small>активных групп</small></div><span class="summary-divider"></span><p>Данные загружены из действующего runtime Mihomo.</p><span class="summary-version">READ ONLY API + ЯВНЫЙ ВЫБОР</span></section><div class="selector-list">${groups.map(proxyCard).join('')}</div>`)}
  <div class="mihomo-privacy-note"><span>i</span><p>Список групп читается через Rust API с устройства. Смена узла отправляется только после нажатия «Выбрать» и подтверждения.</p></div>`;
}

function connectionRow(connection: MihomoConnection): string {
  const route = connection.chains.length ? connection.chains.join(' › ') : 'DIRECT';
  const host = connection.host || connection.destination || 'Адрес недоступен';
  const search = [host, connection.source, route, connection.rule, connection.rulePayload, connection.process].join(' ').toLocaleLowerCase();
  return `<tr data-search="${escapeHtml(search)}"><td><span class="connection-host">${escapeHtml(host)}</span><small>${escapeHtml(connection.destination || connection.network || '—')}</small></td><td><span class="connection-route">${escapeHtml(route)}</span><small>${escapeHtml(connection.rule ? `${connection.rule} · ${connection.rulePayload}` : 'Маршрут из runtime')}</small></td><td>${escapeHtml(connection.source || '—')}<small>${escapeHtml(connection.process || connection.network || '—')}</small></td><td><span class="traffic-up">↑ ${formatBytes(connection.upload)}</span><small class="traffic-down">↓ ${formatBytes(connection.download)}</small></td><td>${escapeHtml(connection.start ? new Date(connection.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')}</td></tr>`;
}

export function renderConnections(data: MihomoConnections | null, loading: boolean, error: string | null): string {
  const state = loadState(loading, error, 'соединения');
  const connections = data?.connections ?? [];
  return `<section class="page-heading mihomo-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> MIHOMO · ЖИВОЙ TRAFFIC</div><h1>Соединения</h1><p>Текущие подключения и их маршруты, полученные от runtime ядра.</p></div><button class="button button-quiet" id="mihomo-refresh"><span>↻</span> Обновить</button></section>
  ${state || `<section class="connections-panel"><div class="connections-toolbar"><div class="connection-total"><span class="live-pulse"></span><strong>${connections.length}</strong><span>активных соединений</span></div><label class="connection-search"><span>⌕</span><input id="connection-filter" type="search" placeholder="Хост, маршрут или приложение" aria-label="Фильтр соединений"></label></div>
    <div class="traffic-summary"><div><small>ПЕРЕДАНО</small><strong>↑ ${formatBytes(data?.uploadTotal ?? 0)}</strong></div><div><small>ПОЛУЧЕНО</small><strong>↓ ${formatBytes(data?.downloadTotal ?? 0)}</strong></div><span class="traffic-footnote">Счётчики Mihomo · суммарно с запуска ядра</span></div>
    <div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>ХОСТ</th><th>ЦЕПОЧКА · ПРАВИЛО</th><th>ИСТОЧНИК</th><th>ТРАФИК</th><th>НАЧАЛО</th></tr></thead><tbody>${connections.map(connectionRow).join('')}</tbody></table>
      ${connections.length === 0 ? '<div class="connection-no-results">Сейчас нет активных соединений.</div>' : ''}<div class="connection-no-results is-filtered" hidden>По этому фильтру соединений нет.</div></div></section>`}
  <div class="mihomo-privacy-note"><span>i</span><p>Данные соединений могут содержать локальные адреса и названия процессов. API панели защищён bearer-ключом и не публикует секрет Mihomo в браузерном коде.</p></div>`;
}
