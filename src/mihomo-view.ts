import type { MihomoConnection, MihomoConnections, MihomoPingResult, MihomoSelector } from './api';
import { displayedConnectionChains, getConnectionHost, sortMihomoConnections, type ConnectionSort, type ConnectionSortKey } from './connection-sort';
import { parseDocument } from 'yaml';

export function orderSelectorsByConfig(groups: MihomoSelector[], content: string): MihomoSelector[] {
  try {
    const config = parseDocument(content, { uniqueKeys: false }).toJS() as { 'proxy-groups'?: unknown } | null;
    const configured = config?.['proxy-groups'];
    if (!Array.isArray(configured)) return groups;
    const order = new Map<string, number>();
    for (const [index, group] of configured.entries()) {
      if (group && typeof group === 'object' && 'name' in group && typeof group.name === 'string') {
        order.set(group.name, index);
      }
    }
    if (order.size === 0) return groups;
    return groups.map((group, index) => ({ group, index })).sort((left, right) =>
      (order.get(left.group.name) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.group.name) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index,
    ).map(({ group }) => group);
  } catch {
    return groups;
  }
}

export function applyPingResults(groups: MihomoSelector[], results: MihomoPingResult[]): MihomoSelector[] {
  const resultByName = new Map(results.map((result) => [result.name, result]));
  return groups.map((group) => ({
    ...group,
    options: group.options.map((option) => {
      const result = resultByName.get(option.name);
      return result ? { ...option, alive: result.delay !== null, delay: result.delay } : option;
    }),
  }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

const COUNTRY_CODES = new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' '));

function renderProxyName(value: string): string {
  const emojiPrefix = value.match(/^([\u{1F1E6}-\u{1F1FF}]{2})(?=\s)/u);
  const textPrefix = emojiPrefix ? null : value.match(/^([a-z]{2})(?=\s)/i);
  const token = emojiPrefix
    ? Array.from(emojiPrefix[1] ?? '').map((letter) => String.fromCharCode((letter.codePointAt(0) ?? 0) - 0x1f1e6 + 65)).join('')
    : textPrefix?.[1];
  if (!emojiPrefix && token && token !== token.toLowerCase() && token !== token.toUpperCase()) return escapeHtml(value);
  const country = token?.toLowerCase();
  if (!country || !COUNTRY_CODES.has(country.toUpperCase())) return escapeHtml(value);
  const label = country.toUpperCase();
  return `<span class="country-flag flag-${country}" role="img" aria-label="${label}"></span>${escapeHtml(value.slice(emojiPrefix?.[0].length ?? 2))}`;
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

function renderSelectorSkeleton(): string {
  const card = () => `<div class="selector-card selector-skeleton-card" aria-hidden="true">
    <div class="selector-skeleton-heading"><span class="skeleton-block skeleton-group-name"></span><span class="skeleton-block skeleton-group-action"></span></div>
    <div class="selector-skeleton-meta"><span class="skeleton-block skeleton-meta-line"></span><span class="skeleton-block skeleton-meta-line is-short"></span></div>
    <div class="proxy-options">${Array.from({ length: 8 }, (_, index) => `<div class="proxy-option skeleton-option"><span class="skeleton-block ${index % 3 === 0 ? 'is-wide' : ''}"></span><span class="skeleton-block is-short"></span></div>`).join('')}</div>
  </div>`;
  return `<div class="selector-list selector-list-skeleton" role="status" aria-busy="true" aria-label="Загружаем селекторы">${card()}${card()}</div>`;
}

function renderConnectionSkeleton(): string {
  const cells = ['route', 'host', 'network', 'source', 'traffic', 'time', 'action'];
  const row = (heading = false) => `<div class="connection-skeleton-row${heading ? ' is-heading' : ''}">${cells.map((cell, index) => `<span class="skeleton-block skeleton-cell is-${cell}${heading && index > 1 ? ' is-short' : ''}"></span>`).join('')}</div>`;
  return `<section class="connections-panel connection-skeleton" role="status" aria-busy="true" aria-label="Загружаются соединения">
    <div class="connections-toolbar" aria-hidden="true"><div class="connection-counts"><span class="skeleton-block skeleton-count"></span><span class="skeleton-block skeleton-count is-short"></span></div><span class="skeleton-block connection-skeleton-filter"></span><span class="skeleton-block connection-skeleton-action"></span></div>
    <div class="connection-table-wrap" aria-hidden="true"><div class="connection-skeleton-table">${row(true)}${Array.from({ length: 7 }, () => row()).join('')}</div></div>
  </section>`;
}

export function renderPingStatusIcon(alive: boolean | null): string {
  if (alive === true) return '';
  const path = alive === false
    ? '<path d="M5 2.5h6l2 2v7l-5 2-5-2v-7z"/><path d="m6.3 5.8 3.4 3.4m0-3.4L6.3 9.2"/>'
    : alive === true
      ? '<path d="M4.5 8.5l2.3 2.3 4.8-5.1"/>'
      : '<path d="M9 1 3 9h4l-1 6 7-9H9z"/>';
  return `<i class="ping-status-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false">${path}</svg></i>`;
}

function proxyCard(group: MihomoSelector): string {
  const groupType = group.type ?? 'Selector';
  const autoManaged = groupType !== 'Selector';
  const options = group.options.map((option) => {
    const selected = option.name === group.current;
    const displayName = option.name;
    const state = option.alive === null ? 'Проверка недоступна' : option.alive ? 'Узел отвечает' : 'Узел не отвечает';
    const delay = option.alive === true && option.delay !== null ? String(option.delay) : '';
    const pingLabel = option.alive === null ? 'Проверить ping' : option.alive ? 'Узел отвечает' : 'Узел не отвечает';
    const badges = [
      option.type && option.type !== 'Unknown' ? `<span class="proxy-protocol-badge">${escapeHtml(option.type.toLowerCase())}</span>` : '',
      option.xudp === true ? '<span class="proxy-transport-badge is-xudp">xudp</span>' : option.udp === true ? '<span class="proxy-transport-badge is-udp">udp</span>' : '',
    ].filter(Boolean).join('');
    const icon = option.icon ? `<img class="proxy-option-icon" src="${escapeHtml(option.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">` : '';
    return `<div class="proxy-option ${selected ? 'is-selected' : ''}">
      <button class="proxy-option-select" type="button" data-proxy-group="${escapeHtml(group.name)}" data-proxy-name="${escapeHtml(option.name)}" ${selected ? 'aria-current="true"' : ''} ${autoManaged ? 'disabled title="Узел выбирается ядром автоматически"' : ''} aria-label="${selected ? 'Текущий узел' : autoManaged ? 'Узел выбирается автоматически' : 'Выбрать узел'}: ${escapeHtml(displayName)}">
        <strong class="proxy-option-name" title="${escapeHtml(displayName)}">${icon}${renderProxyName(displayName)}</strong>
      </button><div class="proxy-option-bottom"><span class="proxy-transport-badges">${badges}</span><button class="proxy-health proxy-ping-value ${option.alive === true ? 'is-alive' : option.alive === false ? 'is-dead' : ''}" type="button" data-ping-proxy="${escapeHtml(option.name)}" data-ping-group="${escapeHtml(group.name)}" title="${state}. Нажмите, чтобы проверить ping" aria-label="${pingLabel}. Нажмите, чтобы повторить ping узла ${escapeHtml(option.name)}">${renderPingStatusIcon(option.alive)}<span>${delay}</span></button></div>
    </div>`;
  }).join('');
  const groupIcon = group.icon ? `<img class="selector-group-icon" src="${escapeHtml(group.icon)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true">` : '';
  return `<section class="selector-card"><header class="selector-card-heading"><div><h2>${groupIcon}${escapeHtml(group.name)}</h2></div><div class="selector-heading-actions"><button class="ping-group" type="button" data-ping-group="${escapeHtml(group.name)}" aria-label="Пинг всех серверов группы ${escapeHtml(group.name)}" title="Пинг всех серверов группы">ϟ</button></div></header>
    <div class="selector-card-meta"><span>${escapeHtml(groupType)} · ${group.options.length}</span><span class="selector-meta-line">›</span><span>${group.current ? renderProxyName(group.current) : autoManaged ? 'Автовыбор ядра' : '—'}</span></div>
    <div class="proxy-options">${options || '<div class="mihomo-inline-empty">В этой группе нет узлов.</div>'}</div>
  </section>`;
}

export function renderSelectors(groups: MihomoSelector[], loading: boolean, error: string | null): string {
  if (loading) return renderSelectorSkeleton();
  const visibleGroups = groups.filter((group) => group.name !== 'GLOBAL');
  const state = loadState(loading, error, 'группы');
  return `${state || (visibleGroups.length === 0 ? '<section class="mihomo-empty"><span class="mihomo-error-mark">◇</span><strong>Группы прокси не найдены</strong><p>API Mihomo ответил, но не вернул группы для выбора или автоматической проверки.</p></section>' : `<div class="selector-list">${visibleGroups.map(proxyCard).join('')}</div>`)}
  `;
}

function connectionRow(connection: MihomoConnection, showSourceName = false, sourceNames: Record<string, string> = {}): string {
  const host = getConnectionHost(connection);
  const displayedChains = displayedConnectionChains(connection);
  const route = displayedChains.length ? displayedChains.join(' → ') : 'Маршрут неизвестен';
  const categories = displayedChains.map((chain) => chain.toLowerCase());
  const network = connection.network.toUpperCase() || '—';
  const startedAt = Date.parse(connection.start);
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
  const started = elapsedSeconds === null ? '—' : elapsedSeconds < 5 ? 'только что' : elapsedSeconds < 60 ? `${elapsedSeconds} сек назад` : elapsedSeconds < 3600 ? `${Math.floor(elapsedSeconds / 60)} мин назад` : `${Math.floor(elapsedSeconds / 3600)} ч назад`;
  const sourceName = showSourceName && connection.sourceIp ? sourceNames[connection.sourceIp] : undefined;
  const source = sourceName || connection.source || 'Неизвестное устройство';
  const sourceTitle = sourceName ? `${sourceName} (${connection.source})` : source;
  const search = [host, source, connection.source, route, connection.rule, connection.rulePayload, connection.process].join(' ').toLocaleLowerCase();
  const appIcon = categories.some((name) => name.includes('telegram')) ? 'telegram'
    : categories.some((name) => name.includes('youtube')) ? 'youtube'
      : categories.some((name) => name.includes('github')) ? 'github'
        : categories.some((name) => name.includes('google')) ? 'google'
          : categories.some((name) => name.includes('cdn')) ? 'web'
            : categories.some((name) => name.includes('meta')) ? 'meta'
              : categories.some((name) => /^ai(?:\b|[-_])/i.test(name)) ? 'ai' : '';
  const appIconSvg: Record<string, string> = {
    telegram: '<path d="m21.5 3.2-3.2 16.1c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.6.6-1.2.6l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.5 13l-5-1.6c-1.1-.4-1.1-1.1.2-1.6L20 2.3c.9-.3 1.7.2 1.5.9Z"/>',
    youtube: '<path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2a31 31 0 0 0-.5 3.8 31 31 0 0 0 .5 3.8 3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-3.8 31 31 0 0 0-.5-3.8ZM10 15.2V8.8l5.5 3.2-5.5 3.2Z"/>',
    github: '<path d="M9 19c-4.3 1.4-4.3-2.3-6-2.8m12 5.6v-3.1a2.7 2.7 0 0 0-.8-2.1c2.7-.3 5.5-1.3 5.5-6A4.7 4.7 0 0 0 18.4 7a4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.2a11.3 11.3 0 0 0-6 0C6.7 3.5 5.7 3.8 5.7 3.8A4.3 4.3 0 0 0 5.6 7a4.7 4.7 0 0 0-1.3 3.5c0 4.7 2.8 5.7 5.5 6A2.7 2.7 0 0 0 9 18.6v3.2"/>',
    google: '<path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.2 2.7-7.1Z"/><path d="M12 21c2.5 0 4.6-.8 6.1-2.2L15 16.4c-.8.5-1.8.8-3 .8a5.2 5.2 0 0 1-4.9-3.6H4v2.5A9.2 9.2 0 0 0 12 21Z"/><path d="M7.1 13.6a5.4 5.4 0 0 1 0-3.3V7.8H4a9.2 9.2 0 0 0 0 8.3l3.1-2.5Z"/><path d="M12 6.7c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9 9 0 0 0 4 7.8l3.1 2.5A5.2 5.2 0 0 1 12 6.7Z"/>',
    meta: '<path d="M3.5 15.3c0 1.8.8 2.8 2.1 2.8 1.1 0 2-.8 3.6-3.2l1.2-1.8c1.9-2.9 3-4.2 4.6-4.2 2.5 0 4.3 2.8 4.3 6.1 0 2.5-.9 4-2.4 4-1.2 0-2.1-.9-3.3-2.8l-2.2-3.5C9.2 8.7 7.8 7 5.6 7 2.5 7 1 10.8 1 14c0 3.4 1.5 5.8 4.2 5.8 2.1 0 3.7-1.6 5.1-3.8l2.1-3.3c1.5-2.4 2.6-3.6 4-3.6 1.6 0 2.6 1.5 2.6 3.5"/>',
    ai: '<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  };
  const routeIcon = appIcon ? `<span class="connection-app-icon is-${appIcon}" aria-hidden="true"><svg viewBox="0 0 24 24">${appIconSvg[appIcon] ?? appIconSvg.web}</svg></span>` : '';
  const chain = displayedChains.length
    ? `<span class="connection-chain" role="group" aria-label="Маршрут: ${escapeHtml(route)}" title="${escapeHtml(route)}">${displayedChains.map((hop, index) => `${index ? '<span class="connection-route-arrow" aria-hidden="true">→</span>' : ''}<span class="connection-route-hop" title="${escapeHtml(hop)}">${renderProxyName(hop)}</span>`).join('')}</span>`
    : `<span class="connection-chain is-unknown" title="Маршрут неизвестен">Маршрут неизвестен</span>`;
  return `<tr data-connection-id="${escapeHtml(connection.id)}" data-search="${escapeHtml(search)}">
    <td class="connection-route-cell${routeIcon ? ' has-app-icon' : ''}"><span class="connection-route-inner">${routeIcon}${chain}</span></td>
    <td class="connection-host" title="${escapeHtml(host)}"><button class="connection-inspect" type="button" data-inspect-connection="${escapeHtml(connection.id)}" aria-label="Подробности соединения ${escapeHtml(host)}">${escapeHtml(host)}</button></td>
    <td class="connection-network" title="Сетевой протокол">${escapeHtml(network)}</td>
    <td class="connection-source" title="${escapeHtml(sourceTitle)}">${escapeHtml(source)}</td>
    <td class="connection-traffic"><span title="Отправлено"><i class="is-upload" aria-hidden="true">↑</i>${formatBytes(connection.upload)}</span><span title="Получено"><i class="is-download" aria-hidden="true">↓</i>${formatBytes(connection.download)}</span></td>
    <td class="connection-time"><time title="Время с начала соединения">${escapeHtml(started)}</time></td>
    <td class="connection-actions"><button class="connection-close" data-close-connection="${escapeHtml(connection.id)}" aria-label="Закрыть соединение ${escapeHtml(host)}" title="Закрыть соединение">×</button></td>
  </tr>`;
}

function connectionSortHeading(key: ConnectionSortKey, label: string, sort: ConnectionSort): string {
  const selected = sort.key === key;
  const arrow = selected ? sort.direction === 'ascending' ? '↑' : '↓' : '↕';
  return `<th scope="col" aria-sort="${selected ? sort.direction : 'none'}"><button class="connection-sort" type="button" data-connection-sort="${key}" aria-label="Сортировать по полю: ${label}">${label}<span aria-hidden="true">${arrow}</span></button></th>`;
}

export function renderConnections(
  data: MihomoConnections | null,
  loading: boolean,
  error: string | null,
  showSourceName = false,
  sourceNames: Record<string, string> = {},
  sort: ConnectionSort = { key: 'start', direction: 'descending' },
): string {
  if (loading) return renderConnectionSkeleton();
  const state = loadState(loading, error, 'соединения');
  const connections = data?.connections ?? [];
  const sortedConnections = sortMihomoConnections(connections, sort, showSourceName ? sourceNames : {});
  const udpCount = connections.filter((connection) => connection.network.toLowerCase() === 'udp').length;
  return `${state || `<section class="connections-panel"><div class="connections-toolbar"><div class="connection-counts"><span class="connection-count-pill" title="Активные соединения"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h3l2-5 3 10 2-6h4"/></svg><strong>${connections.length}</strong></span><span class="connection-count-pill is-secondary" title="UDP-соединения"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l4 8h4M2 12h4l4-8h4"/></svg><strong>${udpCount}</strong></span></div><label class="connection-search"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg><input id="connection-filter" type="search" placeholder="Фильтр" aria-label="Фильтр соединений"><kbd>⌘</kbd></label><button class="connection-close-all" id="close-all-connections" ${connections.length ? '' : 'disabled'}><span aria-hidden="true">⤫</span> Закрыть все</button></div>
    <div class="connection-table-wrap"><table class="connection-table"><thead><tr>${connectionSortHeading('route', 'Цепочка', sort)}${connectionSortHeading('host', 'Хост', sort)}${connectionSortHeading('network', 'Тип', sort)}${connectionSortHeading('source', 'Источник', sort)}${connectionSortHeading('traffic', 'Трафик', sort)}${connectionSortHeading('start', 'Время', sort)}<th scope="col"><span class="visually-hidden">Действия</span></th></tr></thead><tbody>${sortedConnections.map((connection) => connectionRow(connection, showSourceName, sourceNames)).join('')}</tbody></table>
      ${connections.length === 0 ? '<div class="connection-no-results">Сейчас нет активных соединений.</div>' : ''}<div class="connection-no-results is-filtered" hidden>По этому фильтру соединений нет.</div></div></section>`}
  `;
}
