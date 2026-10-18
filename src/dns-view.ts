import type { MihomoDnsResult } from './api';
import { parseDocument } from 'yaml';

export function patchDnsManagement(content: string, enabled: boolean): string {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error(`Конфигурация YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  document.setIn(['dns', 'enable'], enabled);
  document.setIn(['dns', 'listen'], '0.0.0.0:53');
  return document.toString();
}

export interface MihomoDnsSettings {
  enhancedMode: 'redir-host' | 'fake-ip';
  fakeIpFilterMode?: string;
  bootstrap: string;
  nameserver: string;
  nameserverPolicy: string;
  proxyServerNameserver: string;
  fallback: string;
}

const defaultDnsSettings: MihomoDnsSettings = {
  enhancedMode: 'redir-host',
  fakeIpFilterMode: 'blacklist',
  bootstrap: '',
  nameserver: '',
  nameserverPolicy: '',
  proxyServerNameserver: '',
  fallback: '',
};

export function readMihomoDnsSettings(content: string): MihomoDnsSettings {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error(`Конфигурация YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  const root = document.toJS() as { dns?: Record<string, unknown> } | null;
  const dns = root?.dns ?? {};
  const scalar = (key: string): string => {
    const value = dns[key];
    return typeof value === 'string' ? value : '';
  };
  const list = (key: string): string => {
    const value = dns[key];
    return Array.isArray(value) ? value.map(String).join('\n') : typeof value === 'string' ? value : '';
  };
  const rawPolicy = dns['nameserver-policy'];
  const policy = rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)
    ? Object.entries(rawPolicy as Record<string, unknown>).map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(String).join(', ')}]` : String(value)}`).join('\n')
    : '';
  const mode = scalar('enhanced-mode');
  const fakeIpFilterMode = scalar('fake-ip-filter-mode').trim().toLowerCase() || 'blacklist';
  return {
    enhancedMode: mode === 'fake-ip' ? 'fake-ip' : 'redir-host',
    fakeIpFilterMode,
    bootstrap: list('default-nameserver'),
    nameserver: list('nameserver'),
    nameserverPolicy: policy,
    proxyServerNameserver: list('proxy-server-nameserver'),
    fallback: list('fallback'),
  };
}

function parseLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function patchMihomoDnsSettings(content: string, settings: MihomoDnsSettings): string {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error(`Конфигурация YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  document.setIn(['dns', 'enhanced-mode'], settings.enhancedMode);
  const lists: Array<[string, string]> = [
    ['default-nameserver', settings.bootstrap],
    ['nameserver', settings.nameserver],
    ['proxy-server-nameserver', settings.proxyServerNameserver],
    ['fallback', settings.fallback],
  ];
  for (const [key, value] of lists) {
    const values = parseLines(value);
    if (values.length) document.setIn(['dns', key], values);
    else document.deleteIn(['dns', key]);
  }
  if (settings.nameserverPolicy.trim()) {
    const policy = parseDocument(settings.nameserverPolicy);
    const parsedPolicy = policy.toJS();
    if (policy.errors.length || !parsedPolicy || typeof parsedPolicy !== 'object' || Array.isArray(parsedPolicy)) {
      throw new Error('Nameserver Policy должен быть YAML-словарём');
    }
    document.setIn(['dns', 'nameserver-policy'], parsedPolicy);
  } else {
    document.deleteIn(['dns', 'nameserver-policy']);
  }
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

function dnsInfo(description: string): string {
  const hint = escapeHtml(description);
  return `<span class="dns-info" role="img" tabindex="0" title="${hint}" aria-label="Пояснение: ${hint}">i</span>`;
}

export function renderDns(result: MihomoDnsResult | null, loading: boolean, error: string | null, queryName: string, queryType: string, management?: { status: { dnsOverride: boolean; mihomoDns: boolean; portListener: string | null; nameServers: string[]; detail: string } | null; loading: boolean; error: string | null; busy: boolean; confirm: boolean }, dnsConfig?: { values: MihomoDnsSettings | null; loading: boolean; error: string | null; busy: boolean }): string {
  const answers = result?.answers ?? [];
  const status = error
    ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Запрос не выполнен</strong><p>${escapeHtml(error)}</p></div></div>`
    : loading
      ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Проверяем DNS</strong><p>Ждём ответ локального Mihomo API.</p></div></div>'
      : result
        ? `<section class="dns-result"><header><div><span class="selector-kicker">ОТВЕТ MIHOMO</span><h2>${escapeHtml(result.status)}</h2></div><span class="dns-answer-count">${formatAnswerCount(answers.length)}</span></header>${answers.length ? `<div class="dns-record-list">${answers.map((answer) => `<article class="dns-record"><div><strong>${escapeHtml(answer.name)}</strong><span>${escapeHtml(answer.type)}</span></div><code>${escapeHtml(answer.data)}</code><small>${answer.ttl === null ? 'TTL не указан' : `TTL ${answer.ttl} с`}</small></article>`).join('')}</div>` : '<p class="dns-no-answer">В ответе нет записей Answer. Проверьте статус ответа и выбранный тип запроса.</p>'}</section>`
        : '<div class="dns-feedback"><span>◎</span><div><strong>Запустите диагностический запрос</strong><p>Результат будет получен из DNS-резолвера Mihomo на роутере. Настройки не изменяются.</p></div></div>';

  const values = dnsConfig?.values ?? defaultDnsSettings;
  const settingsError = dnsConfig?.error ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Ошибка настроек DNS</strong><p>${escapeHtml(dnsConfig.error)}</p></div></div>` : '';
  const fakeIpFilterMode = values.fakeIpFilterMode || 'blacklist';
  const fakeIpWarning = dnsConfig?.values && values.enhancedMode === 'fake-ip' && !['whitelist', 'rule'].includes(fakeIpFilterMode)
    ? `<aside class="dns-fake-ip-warning" role="note"><span aria-hidden="true">!</span><p><strong>Проверьте режим фильтра fake-ip.</strong> Сейчас используется <code>${escapeHtml(fakeIpFilterMode)}</code>. При таком режиме часть трафика может обходить Mihomo; для <code>fake-ip</code> обычно подходят <code>whitelist</code> или <code>rule</code>. <a href="https://wiki.metacubex.one/ru/config/dns/#fake-ip-filter-mode" target="_blank" rel="noopener noreferrer">Подробнее в документации Mihomo</a></p></aside>`
    : '';
  const modeHelp = 'redir-host — реальные IP в ответах. Медленнее, лучше совместимость, рекомендуется. fake-ip — поддельные IP в ответах. Быстрее, может конфликтовать с исключениями и политиками XKeen, для продвинутых пользователей.';
  const settingsMarkup = dnsConfig?.values ? `<form id="mihomo-dns-settings" class="dns-settings-form">
    <label><span class="dns-field-heading"><span>Enhanced Mode</span>${dnsInfo(`Enhanced Mode: ${modeHelp}`)}</span><select name="enhancedMode"><option value="redir-host" ${values.enhancedMode === 'redir-host' ? 'selected' : ''}>redir-host</option><option value="fake-ip" ${values.enhancedMode === 'fake-ip' ? 'selected' : ''}>fake-ip</option></select></label>
    ${[
      ['bootstrap', 'Default Nameserver', 'Default Nameserver: нужны, чтобы разрешить имена DNS-серверов из других списков.'],
      ['nameserver', 'Nameserver', 'Nameserver: DNS-серверы, используемые для обычных запросов устройств.'],
      ['nameserverPolicy', 'Nameserver Policy', 'Nameserver Policy: назначает отдельные DNS-резолверы доменам или правилам.'],
      ['proxyServerNameserver', 'Proxy Server Nameserver', 'Proxy Server Nameserver: разрешает имена адресов прокси-серверов.'],
      ['fallback', 'Fallback', 'Fallback: резервные DNS-серверы, используемые при проблемах с основными.'],
    ].map(([name, label, description]) => {
      const value = values[name as keyof MihomoDnsSettings] ?? '';
      const rows = Math.max(2, value.split(/\r?\n/).length);
      return `<label class="dns-settings-wide"><span class="dns-field-heading"><span>${label}</span>${dnsInfo(description ?? '')}</span><textarea name="${name}" rows="${rows}" spellcheck="false">${escapeHtml(value)}</textarea></label>`;
    }).join('')}
    <button class="button button-primary" type="submit" ${dnsConfig?.busy || dnsConfig?.loading ? 'disabled' : ''}>${dnsConfig?.busy ? 'Применяем…' : 'Сохранить DNS'}</button></form>` : dnsConfig?.loading ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Загружаем DNS Mihomo</strong><p>Читаем активный конфиг роутера.</p></div></div>' : '<p class="dns-no-answer">Настройки DNS доступны в режиме роутера.</p>';
  const mihomoPanel = `<section class="dns-workspace dns-mihomo-pane"><header class="dns-workspace-heading"><h2>DNS Mihomo</h2></header>${settingsError}${fakeIpWarning}${settingsMarkup}<details class="dns-diagnostics"><summary>DNS Diagnostics</summary><form id="dns-query-form" class="dns-query-form"><label><span class="dns-field-heading"><span>Domain or IP</span>${dnsInfo('Domain or IP: домен или IP-адрес для DNS-запроса через Mihomo на роутере.')}</span><input name="name" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="253" placeholder="example.com" value="${escapeHtml(queryName)}" required></label><label><span class="dns-field-heading"><span>Record Type</span>${dnsInfo('Record Type: тип DNS-записи, которую нужно запросить, например A для IPv4 или AAAA для IPv6.')}</span><select name="type">${['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SRV', 'HTTPS', 'SVCB'].map((type) => `<option ${type === queryType ? 'selected' : ''}>${type}</option>`).join('')}</select></label><button class="button button-primary" type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Запрос…' : 'Проверить'}</button></form>${status}</details></section>`;
  const dnsStatus = management?.status;
  const stateError = management?.error ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Состояние не получено</strong><p>${escapeHtml(management.error)}</p></div></div>` : '';
  const stateLoading = management?.loading ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Читаем состояние</strong><p>Запрашиваем настройки KeeneticOS и Mihomo.</p></div></div>' : '';
  const active = Boolean(dnsStatus?.dnsOverride);
  const inconsistent = Boolean(dnsStatus?.dnsOverride && !dnsStatus.mihomoDns);
  const dnsHandoffMarkup = dnsStatus ? `<div class="dns-runtime-list"><div><span class="dns-field-heading"><span>DNS Override</span>${dnsInfo('DNS Override показывает, перенаправляет ли KeeneticOS IPv4 DNS-запросы на Mihomo.')}</span><strong class="state-pill dns-state-value ${dnsStatus.dnsOverride ? 'state-running' : 'state-stopped'}">${dnsStatus.dnsOverride ? 'Активно' : 'Неактивно'}</strong></div><div><span class="dns-field-heading"><span>DNS Mihomo</span>${dnsInfo('DNS Mihomo показывает, включён ли DNS-резолвер в текущей конфигурации Mihomo.')}</span><strong class="state-pill dns-state-value ${dnsStatus.mihomoDns ? 'state-running' : 'state-stopped'}">${dnsStatus.mihomoDns ? 'Активно' : 'Неактивно'}</strong></div><div><span class="dns-field-heading"><span>Слушатель 53 порта</span>${dnsInfo('Слушатель 53 порта показывает локальный DNS-сервис, который сейчас принимает запросы на роутере.')}</span><strong class="state-pill dns-state-value">${escapeHtml(dnsStatus.portListener || 'Нет слушателя')}</strong></div></div>` : '';
  const confirmAction = management?.confirm ? `<div class="dns-handoff-confirm" role="group" aria-label="Подтверждение изменения DNS">${active ? `<p>Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.</p>` : `<div class="dns-management-help" role="note"><strong>Передача DNS через Mihomo.</strong> IPv4 DNS роутера будет перенаправлен через Mihomo. Статические IPv6 DNS и DoH/DoT не меняются и могут обходить его. Перед остановкой XKeen сначала верните DNS KeeneticOS.</div><p>Mihomo станет DNS-резолвером роутера. Перед включением отключите XKeen -dns и включите игнорирование DNS провайдера. При остановке XKeen без возврата DNS устройства потеряют разрешение имён.</p>`}<button class="button" id="dns-management-cancel" type="button">Отмена</button><button class="button button-primary" id="dns-management-apply" type="button">${active ? 'Подтвердить возврат DNS' : 'Подтвердить включение DNS'}</button></div>` : '';
  const dnsManagementControl = `<div class="dns-management-row"><div class="dns-management-copy"><span class="dns-management-heading"><label for="dns-management-toggle"><strong>Включить управление DNS</strong></label>${dnsInfo('Управление DNS передаёт управление IPv4 DNS роутера Mihomo. Статические IPv6 DNS и DoH/DoT могут обходить это перенаправление.')}</span><small class="dns-management-subtitle">Передача управления DNS от KeeneticOS к Mihomo</small></div><input class="dns-management-switch" id="dns-management-toggle" type="checkbox" role="switch" aria-label="Включить управление DNS" ${active ? 'checked' : ''} ${!dnsStatus || management?.busy || management?.loading || management?.confirm ? 'disabled' : ''}></div>`;
  const handoffPanel = `<section class="dns-workspace dns-handoff-pane"><header class="dns-workspace-heading"><h2>Статус DNS</h2></header>${stateError}${stateLoading}${dnsHandoffMarkup}${inconsistent ? '<div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>Состояния DNS не совпадают</strong><p>Проверьте DNS Override и DNS Mihomo перед переключением.</p></div></div>' : ''}${dnsManagementControl}${management?.confirm ? confirmAction : ''}</section>`;

  return `<div class="dns-dashboard">${handoffPanel}${mihomoPanel}</div>`;
}
