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
  bootstrap: string;
  nameserver: string;
  nameserverPolicy: string;
  proxyServerNameserver: string;
  fallback: string;
}

const defaultDnsSettings: MihomoDnsSettings = {
  enhancedMode: 'redir-host',
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
  return {
    enhancedMode: mode === 'fake-ip' ? 'fake-ip' : 'redir-host',
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
  const settingsMarkup = dnsConfig?.values ? `<form id="mihomo-dns-settings" class="dns-settings-form"><label><span>Enhanced Mode</span><select name="enhancedMode"><option value="redir-host" ${values.enhancedMode === 'redir-host' ? 'selected' : ''}>redir-host</option><option value="fake-ip" ${values.enhancedMode === 'fake-ip' ? 'selected' : ''}>fake-ip</option></select></label>${[
    ['bootstrap', 'Default Nameserver'], ['nameserver', 'Nameserver'], ['nameserverPolicy', 'Nameserver Policy'], ['proxyServerNameserver', 'Proxy Server Nameserver'], ['fallback', 'Fallback'],
  ].map(([name, label]) => `<label class="dns-settings-wide"><span>${label}</span><textarea name="${name}" rows="${name === 'nameserverPolicy' || name === 'nameserver' ? 4 : 2}" spellcheck="false">${escapeHtml(values[name as keyof MihomoDnsSettings])}</textarea></label>`).join('')}<button class="button button-primary" type="submit" ${dnsConfig?.busy || dnsConfig?.loading ? 'disabled' : ''}>${dnsConfig?.busy ? 'Применяем…' : 'Сохранить DNS'}</button></form>` : dnsConfig?.loading ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Загружаем DNS Mihomo</strong><p>Читаем активный конфиг роутера.</p></div></div>' : '<p class="dns-no-answer">Настройки DNS доступны в режиме роутера.</p>';
  const mihomoPanel = `<section class="dns-workspace dns-mihomo-pane"><header class="dns-workspace-heading"><h2>DNS Mihomo</h2></header>${settingsError}${settingsMarkup}<details class="dns-diagnostics"><summary>Проверка DNS</summary><form id="dns-query-form" class="dns-query-form"><label><span>Домен или IP</span><input name="name" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="253" placeholder="example.com" value="${escapeHtml(queryName)}" required></label><label><span>Тип</span><select name="type">${['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SRV', 'HTTPS', 'SVCB'].map((type) => `<option ${type === queryType ? 'selected' : ''}>${type}</option>`).join('')}</select></label><button class="button button-primary" type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Запрос…' : 'Проверить'}</button></form>${status}</details></section>`;
  const dnsStatus = management?.status;
  const stateError = management?.error ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Состояние не получено</strong><p>${escapeHtml(management.error)}</p></div></div>` : '';
  const stateLoading = management?.loading ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Читаем состояние</strong><p>Запрашиваем настройки KeeneticOS и Mihomo.</p></div></div>' : '';
  const stateRefresh = !dnsStatus && !management?.loading ? '<button class="button dns-management-refresh" id="dns-management-refresh" type="button">Повторить проверку</button>' : '';
  const active = Boolean(dnsStatus?.dnsOverride);
  const inconsistent = Boolean(dnsStatus?.dnsOverride && !dnsStatus.mihomoDns);
  const dnsHandoffMarkup = dnsStatus ? `<div class="dns-runtime-list"><div><span>DNS Override</span><strong class="state-pill ${dnsStatus.dnsOverride ? 'state-running' : 'state-stopped'}">${dnsStatus.dnsOverride ? 'Включён' : 'Выключен'}</strong></div><div><span>DNS Mihomo</span><strong class="state-pill ${dnsStatus.mihomoDns ? 'state-running' : 'state-stopped'}">${dnsStatus.mihomoDns ? 'Включён' : 'Выключен'}</strong></div><div><span>Порт 53</span><strong class="state-pill">${escapeHtml(dnsStatus.portListener || 'Нет слушателя')}</strong></div>${dnsStatus.nameServers.length ? `<div><span>DNS-серверы роутера</span><strong>${dnsStatus.nameServers.map(escapeHtml).join(', ')}</strong></div>` : ''}</div>` : '';
  const confirmAction = management?.confirm ? `<div class="dns-handoff-confirm" role="group" aria-label="Подтверждение изменения DNS"><p>${active ? 'Сначала KeeneticOS вернёт сохранённые DNS-серверы. Затем выключится DNS в Mihomo.' : 'Mihomo станет DNS-резолвером роутера. Перед включением отключите XKeen -dns и включите игнорирование DNS провайдера. При остановке XKeen без возврата DNS устройства потеряют разрешение имён.'}</p><button class="button" id="dns-management-cancel" type="button">Отмена</button><button class="button button-primary" id="dns-management-apply" type="button">${active ? 'Вернуть DNS' : 'Включить управление DNS'}</button></div>` : '';
  const handoffPanel = `<section class="dns-workspace dns-handoff-pane"><header class="dns-workspace-heading"><h2>Статус DNS</h2><span class="state-pill ${inconsistent ? 'state-unavailable' : active ? 'state-running' : dnsStatus ? 'state-stopped' : 'state-unavailable'}">${inconsistent ? 'Нужно проверить' : active ? 'Активно' : dnsStatus ? 'Выключено' : 'Статус неизвестен'}</span></header>${stateError}${stateLoading}${stateRefresh}${dnsHandoffMarkup}${inconsistent ? '<div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>Состояния DNS не совпадают</strong><p>Проверьте DNS Override и DNS Mihomo перед переключением.</p></div></div>' : ''}<div class="dns-handoff-intro"><div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>Передача DNS через Mihomo</strong><p>IPv4 DNS Keenetic временно заменяются адресом роутера. Статические IPv6 DNS сохраняются и могут обходить Mihomo; DoH/DoT не меняются. Для возврата сначала восстановите DNS KeeneticOS. Не останавливайте XKeen при активной передаче.</p></div></div></div>${management?.confirm ? confirmAction : `<button class="button button-primary dns-handoff-toggle" id="dns-management-toggle" type="button" ${!dnsStatus || management?.busy || management?.loading ? 'disabled' : ''}>${management?.busy ? '<span class="loading-orbit" aria-hidden="true"></span> Применяем…' : active ? 'Вернуть DNS KeeneticOS' : 'Включить управление DNS'}</button>`}<p class="dns-handoff-note">${escapeHtml(dnsStatus?.detail || 'Состояние будет прочитано перед переключением.')}</p></section>`;

  return `<div class="dns-dashboard">${handoffPanel}${mihomoPanel}</div>`;
}
