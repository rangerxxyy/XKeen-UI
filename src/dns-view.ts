import type { MihomoDnsResult } from './api';
import { parseDocument } from 'yaml';

export function patchDnsManagement(content: string, enabled: boolean): string {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error(`Конфигурация YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  document.setIn(['dns', 'enable'], enabled);
  document.setIn(['dns', 'listen'], '0.0.0.0:53');
  return document.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

function formatAnswerCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'записей'
    : mod10 === 1 ? 'запись' : mod10 >= 2 && mod10 <= 4 ? 'записи' : 'записей';
  return `${count} ${noun}`;
}

export function renderDns(result: MihomoDnsResult | null, loading: boolean, error: string | null, queryName: string, queryType: string, panel: 'mihomo' | 'handoff' = 'mihomo', management?: { status: { dnsOverride: boolean; mihomoDns: boolean; portListener: string | null; nameServers: string[]; detail: string } | null; loading: boolean; error: string | null; busy: boolean; confirm: boolean }): string {
  const answers = result?.answers ?? [];
  const status = error
    ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Запрос не выполнен</strong><p>${escapeHtml(error)}</p></div></div>`
    : loading
      ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Проверяем DNS</strong><p>Ждём ответ локального Mihomo API.</p></div></div>'
      : result
        ? `<section class="dns-result"><header><div><span class="selector-kicker">ОТВЕТ MIHOMO</span><h2>${escapeHtml(result.status)}</h2></div><span class="dns-answer-count">${formatAnswerCount(answers.length)}</span></header>${answers.length ? `<div class="dns-record-list">${answers.map((answer) => `<article class="dns-record"><div><strong>${escapeHtml(answer.name)}</strong><span>${escapeHtml(answer.type)}</span></div><code>${escapeHtml(answer.data)}</code><small>${answer.ttl === null ? 'TTL не указан' : `TTL ${answer.ttl} с`}</small></article>`).join('')}</div>` : '<p class="dns-no-answer">В ответе нет записей Answer. Проверьте статус ответа и выбранный тип запроса.</p>'}</section>`
        : '<div class="dns-feedback"><span>◎</span><div><strong>Запустите диагностический запрос</strong><p>Результат будет получен из DNS-резолвера Mihomo на роутере. Настройки не изменяются.</p></div></div>';

  const mihomoPanel = `<section class="dns-workspace dns-mihomo-pane" ${panel === 'handoff' ? 'hidden' : ''}><header class="dns-workspace-heading"><h2>DNS Mihomo</h2></header><form id="dns-query-form" class="dns-query-form"><label><span>Домен или IP</span><input name="name" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="253" placeholder="example.com" value="${escapeHtml(queryName)}" required></label><label><span>Тип</span><select name="type">${['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SRV', 'HTTPS', 'SVCB'].map((type) => `<option ${type === queryType ? 'selected' : ''}>${type}</option>`).join('')}</select></label><button class="button button-primary" type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Запрос…' : 'Проверить'}</button></form>${status}</section>`;
  const dnsStatus = management?.status;
  const stateError = management?.error ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Состояние не получено</strong><p>${escapeHtml(management.error)}</p></div></div>` : '';
  const stateLoading = management?.loading ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Читаем состояние</strong><p>Запрашиваем настройки KeeneticOS и Mihomo.</p></div></div>' : '';
  const stateRefresh = !dnsStatus && !management?.loading ? '<button class="button dns-management-refresh" id="dns-management-refresh" type="button">Повторить проверку</button>' : '';
  const active = Boolean(dnsStatus?.dnsOverride);
  const inconsistent = Boolean(dnsStatus?.dnsOverride && !dnsStatus.mihomoDns);
  const dnsHandoffMarkup = dnsStatus ? `<div class="dns-runtime-list"><div><span>DNS Override</span><strong class="state-pill ${dnsStatus.dnsOverride ? 'state-running' : 'state-stopped'}">${dnsStatus.dnsOverride ? 'Включён' : 'Выключен'}</strong></div><div><span>DNS Mihomo</span><strong class="state-pill ${dnsStatus.mihomoDns ? 'state-running' : 'state-stopped'}">${dnsStatus.mihomoDns ? 'Включён' : 'Выключен'}</strong></div><div><span>Порт 53</span><strong class="state-pill">${escapeHtml(dnsStatus.portListener || 'Нет слушателя')}</strong></div>${dnsStatus.nameServers.length ? `<div><span>DNS IPv4 роутера</span><strong>${dnsStatus.nameServers.map(escapeHtml).join(', ')}</strong></div>` : ''}</div>` : '';
  const confirmAction = management?.confirm ? `<div class="dns-handoff-confirm" role="group" aria-label="Подтверждение изменения DNS"><p>${active ? 'Сначала отключится DNS в Mihomo, затем KeeneticOS вернёт прежние DNS-серверы.' : 'Mihomo станет DNS-резолвером роутера. При остановке XKeen без возврата DNS устройства потеряют разрешение имён.'}</p><button class="button" id="dns-management-cancel" type="button">Отмена</button><button class="button button-primary" id="dns-management-apply" type="button">${active ? 'Вернуть DNS' : 'Включить DNS Mihomo'}</button></div>` : '';
  const handoffPanel = `<section class="dns-workspace dns-handoff-pane" ${panel === 'mihomo' ? 'hidden' : ''}><header class="dns-workspace-heading"><h2>Управление DNS</h2><span class="state-pill ${inconsistent ? 'state-unavailable' : active ? 'state-running' : 'state-stopped'}">${inconsistent ? 'Нужно проверить' : active ? 'Активно' : dnsStatus ? 'Выключено' : 'Статус неизвестен'}</span></header>${stateError}${stateLoading}${stateRefresh}${dnsHandoffMarkup}${inconsistent ? '<div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>Состояния DNS не совпадают</strong><p>Проверьте DNS Override и DNS Mihomo перед переключением. Кнопка ниже ориентируется на фактический DNS Override KeeneticOS.</p></div></div>' : ''}<div class="dns-handoff-intro"><div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>DNS зависит от работы Mihomo</strong><p>Перед включением проверьте активную конфигурацию DNS Mihomo. Статические IPv4 DNS-серверы Keenetic временно заменяются адресом роутера. IPv6 DNS и настройки DoH/DoT эта функция не меняет. Пока DNS Override включён, не останавливайте XKeen: сначала верните DNS KeeneticOS.</p></div></div></div>${management?.confirm ? confirmAction : `<button class="button button-primary dns-handoff-toggle" id="dns-management-toggle" type="button" ${!dnsStatus || management?.busy || management?.loading ? 'disabled' : ''}>${management?.busy ? '<span class="loading-orbit" aria-hidden="true"></span> Применяем…' : active ? 'Вернуть DNS KeeneticOS' : 'Передать DNS Mihomo'}</button>`}<p class="dns-handoff-note">${escapeHtml(dnsStatus?.detail || 'Состояние будет прочитано перед переключением.')}</p></section>`;

  return `<nav class="dns-subnav" aria-label="Режим DNS"><button type="button" class="dns-subnav-button ${panel === 'mihomo' ? 'is-active' : ''}" data-dns-panel="mihomo" aria-pressed="${panel === 'mihomo'}">Mihomo</button><button type="button" class="dns-subnav-button ${panel === 'handoff' ? 'is-active' : ''}" data-dns-panel="handoff" aria-pressed="${panel === 'handoff'}">Система</button></nav>${mihomoPanel}${handoffPanel}`;
}
