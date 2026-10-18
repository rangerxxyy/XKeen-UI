import type { MihomoConnection, MihomoConnections, MihomoPingResult, MihomoSelector } from './api';
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

export function renderPingStatusIcon(alive: boolean | null): string {
  if (alive === true) return '';
  const path = alive === false
    ? '<path d="M5 2.5h6l2 2v7l-5 2-5-2v-7z"/><path d="M8 5v4m-1.5-2h3"/>'
    : alive === true
      ? '<path d="M4.5 8.5l2.3 2.3 4.8-5.1"/>'
      : '<path d="M9 1 3 9h4l-1 6 7-9H9z"/>';
  return `<i class="ping-status-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false">${path}</svg></i>`;
}

function proxyCard(group: MihomoSelector): string {
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
      <button class="proxy-option-select" type="button" data-proxy-group="${escapeHtml(group.name)}" data-proxy-name="${escapeHtml(option.name)}" ${selected ? 'aria-current="true"' : ''} aria-label="${selected ? 'Текущий узел' : 'Выбрать узел'}: ${escapeHtml(displayName)}">
        <strong class="proxy-option-name" title="${escapeHtml(displayName)}">${icon}${renderProxyName(displayName)}</strong>
      </button><div class="proxy-option-bottom"><span class="proxy-transport-badges">${badges}</span><button class="proxy-health proxy-ping-value ${option.alive === true ? 'is-alive' : option.alive === false ? 'is-dead' : ''}" type="button" data-ping-proxy="${escapeHtml(option.name)}" data-ping-group="${escapeHtml(group.name)}" title="${state}. Нажмите, чтобы проверить ping" aria-label="${pingLabel}. Нажмите, чтобы повторить ping узла ${escapeHtml(option.name)}">${renderPingStatusIcon(option.alive)}<span>${delay}</span></button></div>
    </div>`;
  }).join('');
  const groupIcon = group.icon ? `<img class="selector-group-icon" src="${escapeHtml(group.icon)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true">` : '';
  return `<section class="selector-card"><header class="selector-card-heading"><div><h2>${groupIcon}${escapeHtml(group.name)}</h2></div><div class="selector-heading-actions"><button class="ping-group" type="button" data-ping-group="${escapeHtml(group.name)}" aria-label="Пинг всех серверов группы ${escapeHtml(group.name)}" title="Пинг всех серверов группы">ϟ</button></div></header>
    <div class="selector-card-meta"><span>Selector (${group.options.length})</span><span class="selector-meta-line">›</span><span>${group.current ? renderProxyName(group.current) : '—'}</span></div>
    <div class="proxy-options">${options || '<div class="mihomo-inline-empty">В этой группе нет узлов.</div>'}</div>
  </section>`;
}

export function renderSelectors(groups: MihomoSelector[], loading: boolean, error: string | null): string {
  const visibleGroups = groups.filter((group) => group.name !== 'GLOBAL');
  const state = loadState(loading, error, 'группы');
  return `${state || (visibleGroups.length === 0 ? '<section class="mihomo-empty"><span class="mihomo-error-mark">◇</span><strong>Группы Selector не найдены</strong><p>API Mihomo ответил, но не вернул выбираемых групп.</p></section>' : `<div class="selector-list">${visibleGroups.map(proxyCard).join('')}</div>`)}
  `;
}

function connectionRow(connection: MihomoConnection, showSourceName = false, sourceNames: Record<string, string> = {}): string {
  const rawHost = connection.host;
  const host = rawHost ? connection.destinationPort && !/\]:\d+$/.test(rawHost) && !/^[^:]+:\d+$/.test(rawHost)
    ? `${rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost}:${connection.destinationPort}` : rawHost
    : connection.destination || 'Адрес недоступен';
  const displayedChains = [...connection.chains].reverse();
  const route = displayedChains.length ? displayedChains.join(' › ') : 'Маршрут неизвестен';
  const category = displayedChains[0]?.toLowerCase() ?? '';
  const search = [host, connection.source, route, connection.rule, connection.rulePayload, connection.process].join(' ').toLocaleLowerCase();
  const network = connection.network.toUpperCase() || '—';
  const startedAt = Date.parse(connection.start);
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
  const started = elapsedSeconds === null ? '—' : elapsedSeconds < 5 ? 'только что' : elapsedSeconds < 60 ? `${elapsedSeconds} сек назад` : elapsedSeconds < 3600 ? `${Math.floor(elapsedSeconds / 60)} мин назад` : `${Math.floor(elapsedSeconds / 3600)} ч назад`;
  const sourceName = showSourceName && connection.sourceIp ? sourceNames[connection.sourceIp] : undefined;
  const source = sourceName || connection.source || 'Неизвестное устройство';
  const sourceTitle = sourceName ? `${sourceName} (${connection.source})` : source;
  const appIcon = category.includes('youtube') ? 'youtube' : category.includes('github') ? 'github' : category.includes('google') ? 'google' : category.includes('cdn') ? 'web' : category.includes('meta') ? 'meta' : category === 'ai' ? 'ai' : '';
  const appGlyph = appIcon === 'youtube' ? '▶' : appIcon === 'github' ? '●' : appIcon === 'google' ? 'G' : appIcon === 'meta' ? '∞' : appIcon === 'ai' ? '✦' : '◎';
  const routeIcon = appIcon ? `<span class="connection-app-icon is-${appIcon}" aria-hidden="true">${appGlyph}</span>` : '';
  const chain = `<span class="connection-chain" title="${escapeHtml(route)}">${displayedChains.length ? displayedChains.map(renderProxyName).join(' <span aria-hidden="true">›</span> ') : escapeHtml(route)}</span>`;
  return `<tr data-search="${escapeHtml(search)}">
    <td class="connection-route-cell${routeIcon ? ' has-app-icon' : ''}"><span class="connection-route-inner">${routeIcon}${chain}</span></td>
    <td class="connection-host" title="${escapeHtml(host)}"><button class="connection-inspect" type="button" data-inspect-connection="${escapeHtml(connection.id)}" aria-label="Подробности соединения ${escapeHtml(host)}">${escapeHtml(host)}</button></td>
    <td class="connection-network" title="Сетевой протокол">${escapeHtml(network)}</td>
    <td class="connection-source" title="${escapeHtml(sourceTitle)}">${escapeHtml(source)}</td>
    <td class="connection-traffic"><span title="Отправлено"><i class="is-upload" aria-hidden="true">↑</i>${formatBytes(connection.upload)}</span><span title="Получено"><i class="is-download" aria-hidden="true">↓</i>${formatBytes(connection.download)}</span></td>
    <td class="connection-time"><time title="Время с начала соединения">${escapeHtml(started)}</time></td>
    <td class="connection-actions"><button class="connection-close" data-close-connection="${escapeHtml(connection.id)}" aria-label="Закрыть соединение ${escapeHtml(host)}" title="Закрыть соединение">×</button></td>
  </tr>`;
}

export function renderConnections(data: MihomoConnections | null, loading: boolean, error: string | null, showSourceName = false, sourceNames: Record<string, string> = {}): string {
  const state = loadState(loading, error, 'соединения');
  const connections = data?.connections ?? [];
  const udpCount = connections.filter((connection) => connection.network.toLowerCase() === 'udp').length;
  return `${state || `<section class="connections-panel"><div class="connections-toolbar"><div class="connection-counts"><span class="connection-count-pill" title="Активные соединения"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h3l2-5 3 10 2-6h4"/></svg><strong>${connections.length}</strong></span><span class="connection-count-pill is-secondary" title="UDP-соединения"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l4 8h4M2 12h4l4-8h4"/></svg><strong>${udpCount}</strong></span></div><label class="connection-search"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9 8v4l-2 1V8L2 3Z"/></svg><input id="connection-filter" type="search" placeholder="Фильтр" aria-label="Фильтр соединений"><kbd>⌘</kbd></label><button class="connection-close-all" id="close-all-connections" ${connections.length ? '' : 'disabled'}><span aria-hidden="true">⤫</span> Закрыть все</button></div>
    <div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>Цепочка <span>↕</span></th><th>Хост <span>↕</span></th><th>Тип <span>↕</span></th><th>Источник <span>↕</span></th><th>Трафик <span>↕</span></th><th>Время <span class="is-sorted">↓</span></th><th aria-label="Действия"></th></tr></thead><tbody>${connections.map((connection) => connectionRow(connection, showSourceName, sourceNames)).join('')}</tbody></table>
      ${connections.length === 0 ? '<div class="connection-no-results">Сейчас нет активных соединений.</div>' : ''}<div class="connection-no-results is-filtered" hidden>По этому фильтру соединений нет.</div></div></section>`}
  `;
}
