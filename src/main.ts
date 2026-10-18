import './fonts.css';
import './country-flags.css';
import './style.css';
import './typography.css';
import './connection-details.css';
import './styled-select.css';
import './ui-polish.css';
import { enhanceStyledSelects, syncStyledSelects } from './styled-select';
import { CONFIG_APPLY_EVENT, type ConfigApplyEventDetail } from './config-actions';
import { createSettingsLoader, type SettingsLoader } from './settings-load';
import { renderConnectionDetails } from './connection-details';
import { applyActiveMihomoConfig, closeAllMihomoConnections, closeMihomoConnection, controlXkeen, getActiveMihomoConfig, getCoreSources, getHealth, getMihomoConnections, getMihomoSelectors, getMihomoVersion, getRouterDeviceList, getRouterDnsStatus, getStatus, getSystemLog, getUpdateProxies, getXkeenStatus, logUiError, pingMihomoGroup, pingMihomoProxy, queryMihomoDns, requestAppUpdate, saveCoreSources, saveUpdateProxies, selectMihomoProxy, setRouterDnsManagement, type ApiState, type CoreSources, type MihomoConnections, type MihomoDnsResult, type MihomoSelector, type RouterDnsStatus, type SystemLog, type XkeenStatus } from './api';
import { applyPingResults, collectConnectionProxyIcons, orderSelectorsByConfig, renderConnections, renderPingStatusIcon, renderSelectorDestination, renderSelectors } from './mihomo-view';
import { patchDnsManagement, patchMihomoDnsSettings, readMihomoDnsSettings, renderDns, type MihomoDnsSettings } from './dns-view';
import { bindDnsTextareaGrowth } from './dns-textarea-growth';
import { fetchConfiguredCoreReleases, isStableCompatibleRelease, openCoreReleaseDialog } from './core-releases';
import { openCoreManagerDialog } from './core-manager';
import { appUpdateProgressFromLog, isInstalledReleaseVersion, isNewerVersion, listAppReleases, type AppRelease } from './app-update';
import { confirmInApp } from './confirm-dialog';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';
import { lifecycleFeedback } from './service-feedback';
import { readUiPreferences, validPingUrl, writeUiPreferences, type UiPreferences } from './preferences';
import { deduplicateRepeatedUiErrors, formatJournalMessage, formatJournalTimestamp, getJournalViewState, renderJournalLoadingSkeleton, splitJournalLevel, stripLogSourceLabel } from './journal-view-state';
import { getJournalScrollTop, getNewJournalLines, hasJournalLinesChanged } from './journal-scroll';
import { createAsyncStatusCache } from './dns-status-cache';
import { getAffectedConnectionIds, queueSelectorWrite, restoreProxySelection, selectProxyOptimistically } from './selector-selection';
import { hideClearedJournalLines, rememberClearedJournal } from './journal-clear';
import { journalExpandIcon, journalExpandLabel } from './journal-ui';
import { renderAppReleaseActions, renderAppUpdateNotice, renderAppVersionChip } from './app-release-ui';
import { SETTINGS_TABS, type SettingsTabId } from './settings-tabs';
import { bindSelectorSortControl, renderSelectorSortControl } from './selector-sort-control';
import { bindPingUrlControl, renderPingUrlControl } from './ping-url-control';
import { SourceNameResolver } from './source-names';
import { renderResourceMetrics } from './resource-metrics';
import { shouldReportUiError } from './ui-error-dedupe';
import { sortMihomoConnections, type ConnectionSort, type ConnectionSortKey } from './connection-sort';
import { MAIN_NAVIGATION_PAGES, renderNavigationView, renderWorkspaceFrame } from './navigation-view';
import { renderEditorUtilitiesMenu } from './editor-utilities';
import { openRulesetsDialog } from './rulesets-view';
import { openSubscriptionsDialog } from './subscriptions-view';

type Page = 'selectors' | 'connections' | 'configuration' | 'dns';

const pages = MAIN_NAVIGATION_PAGES;

const state: ApiState = { connected: false, status: null, error: null, checkedAt: null };
type YamlEditorModule = typeof import('./yaml-editor');
let yamlEditorModule: YamlEditorModule | null = null;
let yamlEditorLoad: Promise<YamlEditorModule> | null = null;
let activePage: Page = 'selectors';
let animatePageEntry = false;
let refreshTimer: number | undefined;
let autoUpdateTimer: number | undefined;
const updateNotices = new Set<string>();
let requestController: AbortController | undefined;
let mihomoController: AbortController | undefined;
let selectors: MihomoSelector[] = [];
let selectorsLoading = true;
let selectorsError: string | null = null;
const selectorSelectionQueues = new Map<string, Promise<void>>();
const selectorSelectionVersions = new Map<string, number>();
const confirmedSelectorSelections = new Map<string, string | null>();
let connections: MihomoConnections | null = null;
let connectionSourceNames: Record<string, string> = {};
let connectionSort: ConnectionSort = { key: 'start', direction: 'descending' };
const sourceNameResolver = new SourceNameResolver(() => getRouterDeviceList());
let connectionsLoading = true;
let connectionsError: string | null = null;
let dnsResult: MihomoDnsResult | null = null;
let dnsLoading = false;
let dnsError: string | null = null;
let dnsQueryName = '';
let dnsQueryType = 'A';
let dnsController: AbortController | undefined;
let dnsManagementStatus: RouterDnsStatus | null = null;
const dnsStatusCache = createAsyncStatusCache<RouterDnsStatus>();
let dnsManagementLoading = false;
let dnsManagementError: string | null = null;
let dnsManagementBusy = false;
let dnsManagementConfirm = false;
let dnsConfig: { content: string; values: MihomoDnsSettings } | null = null;
let dnsConfigLoading = false;
let dnsConfigError: string | null = null;
let dnsConfigBusy = false;
let mihomoVersion: string | null = null;
let xkeenStatus: XkeenStatus | null = null;
let xkeenControlBusy = false;
let configApplyBusy = false;
let xkeenControlAction: 'start' | 'stop' | 'restart' | null = null;
const logFiles = [
  { id: 'xkeen-ui', label: 'error.log' },
  { id: 'xray-access', label: 'access.log' },
];
let selectedLog = 'xkeen-ui';
let logData: SystemLog | null = null;
let logNewLines = new Set<string>();
let logError: string | null = null;
let logLoading = false;
let logCleared = false;
let logExpanded = false;
let logFilter = '';
let logController: AbortController | undefined;
let logRefreshTimer: number | undefined;
let logRefreshAfterCurrent = false;
let appRelease: AppRelease | null = null;
let appReleases: AppRelease[] = [];
let appUpdateAvailable: AppRelease | null = null;
let appUpdateNoticeDismissed = false;
let appUpdateMessage = 'Подготовка обновления…';
let appUpdateInstalling = false;
let uiPreferences: UiPreferences = readUiPreferences();
const proxyPingFailures = new Map<string, number>();
const recentUiErrors = new Map<string, number>();

function applyUiTheme(): void {
  const theme = uiPreferences.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

applyUiTheme();

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Корневой элемент интерфейса #app не найден');
const APP_VERSION = __APP_VERSION__;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

function formatAppReleaseNotes(value: string): string {
  return value.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '<br>';
    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) return `<strong>${escapeHtml(heading[1] ?? '')}</strong>`;
    if (/^[-*]\s+/.test(trimmed)) return `<span class="app-release-bullet">•</span> ${escapeHtml(trimmed.replace(/^[-*]\s+/, '').replace(/`([^`]+)`/g, '$1'))}`;
    return escapeHtml(trimmed.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)'));
  }).join('<br>');
}

function renderHeader(): string {
  const serviceBusy = xkeenControlBusy || configApplyBusy || appUpdateInstalling;
  const status = state.status;
  const service = status?.services.find((item) => item.name.toLowerCase() === 'mihomo');
  const xkeenRunning = status?.mode === 'router' ? xkeenStatus?.running === true : service?.state === 'running';
  const formatVersion = (version: string) => `v${escapeHtml(version.replace(/^v+/i, ''))}`;
  const coreLabel = mihomoVersion ? formatVersion(mihomoVersion) : service ? (service.version ? formatVersion(service.version) : service.state === 'running' ? 'Активен' : service.state === 'stopped' ? 'Остановлен' : 'Недоступен') : state.connected ? 'Не проверен' : 'Ожидание';
  const serviceText = appUpdateInstalling
    ? 'Обновление XKeen UI…'
    : serviceBusy
    ? `${xkeenControlAction === 'stop' ? 'Остановка' : xkeenControlAction === 'start' ? 'Запуск' : 'Перезапуск'} XKeen…`
    : status?.mode === 'router'
      ? xkeenStatus?.installed
        ? xkeenStatus.running === true ? 'XKeen запущен' : xkeenStatus.running === false ? 'XKeen остановлен' : 'Статус XKeen недоступен'
        : 'XKeen не найден'
      : service ? (service.state === 'running' ? 'Сервис запущен' : service.state === 'stopped' ? 'Сервис остановлен' : 'Статус недоступен') : 'Состояние загружается';
  const resourceMetrics = renderResourceMetrics(status?.memory ?? null, status?.cpuPercent ?? null);
  const canControl = status?.mode === 'router' && Boolean(xkeenStatus?.installed);
  const controls = canControl
    ? `${xkeenStatus?.running === false
      ? `<button class="header-service-action" data-xkeen-action="start" type="button" title="Запустить XKeen" aria-label="Запустить XKeen" ${serviceBusy ? 'disabled' : ''}>${serviceBusy && xkeenControlAction === 'start' ? '<span class="service-control-spinner" aria-hidden="true"></span>' : '▶'}</button>`
      : `<button class="header-service-action header-service-restart" data-xkeen-action="restart" type="button" title="Перезапустить XKeen" aria-label="Перезапустить XKeen" ${serviceBusy ? 'disabled' : ''}>${configApplyBusy || (xkeenControlBusy && xkeenControlAction === 'restart') ? '<span class="service-control-spinner" aria-hidden="true"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.9 9a7.5 7.5 0 0 1 12.4-2L20 12M4 17v-5h5m10.1 3a7.5 7.5 0 0 1-12.4 2L4 12"/></svg>'}</button><button class="header-service-action header-service-stop" data-xkeen-action="stop" type="button" title="Остановить XKeen" aria-label="Остановить XKeen" ${serviceBusy || xkeenStatus?.running !== true ? 'disabled' : ''}>${serviceBusy && xkeenControlAction === 'stop' ? '<span class="service-control-spinner" aria-hidden="true"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'}</button>`}`
    : '';
  return `<header class="topbar">
    <div class="top-status-cluster ${serviceBusy ? 'is-xkeen-busy' : ''}"><div class="top-status" aria-label="Состояние XKeen" aria-live="polite"><span id="status-led" class="connection-led ${xkeenRunning ? 'is-online' : 'is-offline'}"></span><span><strong id="service-label">${escapeHtml(serviceText)}</strong><small id="service-summary">${state.connected ? resourceMetrics : 'Ожидание соединения с backend'}</small></span></div><div class="header-service-controls" aria-label="Управление XKeen" aria-busy="${serviceBusy}">${controls}</div></div>
    <a class="brand" href="#selectors" aria-label="XKeen UI, селекторы"><span>XKeen <b>UI</b></span></a>
    <div class="top-actions"><button class="version-chip core-chip core-version-button" id="core-version" type="button" title="Управление ядрами" aria-label="Управление ядрами"><svg class="chip-icon chip-cpu-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 1v2m4-2v2m-4 10v2m4-2v2M1 6h2m-2 4h2m10-4h2m-2 4h2"/></svg> Mihomo <b id="core-version-label">${coreLabel}</b><span class="chip-chevron" aria-hidden="true">⌄</span></button><button class="version-chip subscriptions-open" id="subscriptions-open" type="button" title="Просмотр подписок Mihomo"><svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/></svg><span>Подписки</span></button><button class="version-chip rulesets-open" id="rulesets-open" type="button" title="Просмотр файлов rule-set Mihomo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5 8h6M5 10.5h6"/></svg><span>Рулсеты</span></button>${renderAppVersionChip(status?.appVersion ?? APP_VERSION, Boolean(appUpdateAvailable))}<button class="icon-button" id="settings" title="Настройки" aria-label="Настройки">⚙</button></div>
  </header>`;
}

function renderNavigation(): string {
  return renderNavigationView(pages, activePage, activePage === 'configuration' ? renderConfigFileButtons() : '');
}

function renderConfigFileButtons(): string {
  const xray = xkeenStatus?.core === 'xray';
  const xrayFiles = ['xray_log', 'xray_inbounds', 'xray_json', 'xray_routing', 'xray_policy'];
  const ids = [...(xray ? xrayFiles : ['config']), 'ip_exclude', 'port_exclude', 'port_proxying', 'xkeen'];
  const defaultFile = xray ? 'xray_json' : 'config';
  const savedFile = sessionStorage.getItem('xkeen-ui:draft-active-file');
  const activeFile = xray
    ? savedFile === 'xray_jsonc' ? 'xray_routing' : xrayFiles.includes(savedFile ?? '') ? savedFile : defaultFile
    : ids.includes(savedFile ?? '') ? savedFile : defaultFile;
  const labels: Record<string, string> = { config: 'config', xray_json: 'outbounds', xray_log: 'log', xray_inbounds: 'inbounds', xray_policy: 'policy', ip_exclude: 'ip_exclude', port_exclude: 'port_exclude', port_proxying: 'port_proxying', xkeen: 'xkeen', xray_routing: 'routing' };
  const descriptions: Record<string, string> = {
    config: 'Основной конфиг Mihomo', xray_log: 'Настройки журнала Xray', xray_inbounds: 'Входящие подключения Xray', xray_json: 'Исходящие подключения Xray', xray_routing: 'Правила маршрутизации Xray', xray_policy: 'Политики Xray',
    ip_exclude: 'IP-адреса и подсети вне обработки XKeen', port_exclude: 'Порты, исключённые из обработки XKeen',
    port_proxying: 'Порты, направляемые через прокси', xkeen: 'Параметры запуска и маршрутизации XKeen',
  };
  const buttons = ids.map((id) => {
    const fileId = id;
    const selected = fileId === activeFile;
    return `<button class="config-file-tab ${selected ? 'selected' : ''}" data-config-file="${fileId}" type="button" title="${descriptions[fileId] ?? descriptions[id] ?? id}" aria-label="${labels[id] ?? id}: ${descriptions[fileId] ?? descriptions[id] ?? id}" aria-pressed="${selected}">${labels[id] ?? id}</button>`;
  });
  const primaryConfig = xray ? '' : buttons.shift() ?? '';
  return `${primaryConfig ? `<div class="config-file-primary" aria-label="Основной конфиг">${primaryConfig.replace('config-file-tab ', 'config-file-tab config-file-primary-tab ')}</div>` : ''}<div class="config-file-nav" aria-label="Файлы конфигурации">${buttons.join('')}</div>`;
}

function renderComingSoon(page: Page): string {
  const current = pages.find((item) => item.id === page);
  if (page === 'configuration') return renderConfiguration();
  const descriptions: Record<Page, string> = {
    selectors: 'Подключите проверенный Mihomo API, чтобы показывать фактические группы, узлы и выбранные значения.',
    connections: 'Здесь появятся соединения, источники, цепочки прокси и объёмы трафика из runtime API ядра.',
    dns: 'Управление DNS будет раздельным для Mihomo и Xray, с проверкой конфигурации и безопасным применением.',
    configuration: 'Редактор профилей появится после подключения YAML/JSON валидаторов и сценария резервного копирования.',
  };
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> XKeen UI</div><h1>${current?.label ?? ''}</h1><p>${descriptions[page]}</p></div></section><section class="feature-placeholder"><div class="placeholder-symbol">${current?.icon ?? '◌'}</div><div class="placeholder-copy"><span class="status-label">ИНТЕГРАЦИЯ ЯДРА</span><h2>Для этого раздела ещё не подключён проверенный API</h2><p>${descriptions[page]}</p><p class="placeholder-note">Данные появятся после подключения подтверждённого системного источника.</p></div></section>`;
}

function renderConfiguration(): string {
  return `<section class="editor-workspace config-layout" aria-label="Редактор конфигурации">
    <div class="config-editor-main">
      <div class="code-editor-shell"><div class="code-editor" id="yaml-editor" aria-label="Текст конфигурации"></div></div>
        <div class="editor-statusbar"><span id="yaml-validation" class="editor-validation" aria-live="polite">Проверка конфигурации…</span><div class="editor-actions"><button class="editor-button editor-button-primary" id="config-apply-active" type="button" data-router-file disabled title="Проверить, сохранить и перезапустить активное ядро">Применить</button><button class="editor-button" id="config-save-active" type="button" data-router-file disabled title="Сохранить файл на роутере без применения">Сохранить</button><button class="editor-button" id="config-format-active" type="button" title="Отформатировать файл">&lt;/&gt; Формат</button><details class="editor-utilities"><summary class="editor-button"><span class="utilities-trigger-icon" aria-hidden="true">•••</span><span>Утилиты</span><span class="utilities-chevron" aria-hidden="true"></span></summary>${renderEditorUtilitiesMenu()}</details></div></div>
    </div>
  </section>`;
}

function renderJournal(): string {
  const expandLabel = journalExpandLabel(logExpanded);
  const clearIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
  return `<section class="journal-panel ${logExpanded ? 'is-expanded' : ''}" aria-label="Журнал событий"><header class="journal-heading"><div class="journal-title"><h2>Журнал</h2><span id="journal-live" class="journal-live" ${xkeenControlBusy || configApplyBusy ? '' : 'hidden'}><i aria-hidden="true"></i> XKeen запускается</span></div><div class="journal-tools"><label class="journal-filter"><span aria-hidden="true">⌕</span><input id="journal-filter" type="search" placeholder="Фильтр" aria-label="Фильтр журнала" value="${escapeHtml(logFilter)}"></label><select id="journal-file" aria-label="Файл журнала">${logFiles.map((file) => `<option value="${file.id}" ${selectedLog === file.id ? 'selected' : ''}>${file.label}</option>`).join('')}</select><button class="journal-icon-button journal-clear-button" id="journal-clear" type="button" title="Очистить журнал в этом браузере" aria-label="Очистить журнал">${clearIcon}</button><button class="journal-icon-button journal-expand-button" id="journal-expand" type="button" title="${expandLabel}" aria-label="${expandLabel}" aria-pressed="${logExpanded}">${journalExpandIcon(logExpanded)}</button></div></header><div class="journal-body" id="journal-body" aria-live="off"></div><span class="sr-only" id="journal-announcement" role="status" aria-live="polite"></span></section>`;
}

function setJournalRealtime(active: boolean): void {
  const indicator = document.querySelector<HTMLElement>('#journal-live');
  if (indicator) {
    indicator.hidden = !active;
    const label = configApplyBusy ? 'Перезапуск ядра' : xkeenControlAction === 'stop' ? 'Остановка XKeen' : xkeenControlAction === 'restart' ? 'Перезапуск XKeen' : 'Запуск XKeen';
    indicator.lastChild!.textContent = ` ${label}`;
  }
}

function drawJournal(): void {
  const body = document.querySelector<HTMLElement>('#journal-body');
  if (!body) return;
  const viewState = getJournalViewState({ loading: logLoading, hasData: logData !== null, error: logError, cleared: logCleared });
  if (viewState === 'loading') {
    body.innerHTML = renderJournalLoadingSkeleton();
    return;
  }
  if (viewState === 'error') {
    body.innerHTML = `<div class="journal-empty"><span class="journal-empty-icon">!</span><strong>Журнал недоступен</strong><p>${escapeHtml(logError ?? 'Не удалось загрузить журнал')}</p></div>`;
    return;
  }
  if (viewState === 'cleared') {
    body.innerHTML = '<div class="journal-empty"><span class="journal-empty-icon">✓</span><strong>Отображение очищено</strong></div>';
    return;
  }
  const filter = logFilter.trim().toLocaleLowerCase();
  const lines = deduplicateRepeatedUiErrors(logData?.lines ?? []).filter((line) => {
    return !filter || line.toLocaleLowerCase().includes(filter);
  });
  const previousList = body.querySelector<HTMLElement>('.journal-lines');
  const previousScroll = previousList ? {
    scrollTop: previousList.scrollTop,
    clientHeight: previousList.clientHeight,
    scrollHeight: previousList.scrollHeight,
  } : null;
  const list = document.createElement('div');
  list.className = 'journal-lines';
  for (const line of lines) {
    const displayLine = stripLogSourceLabel(line);
    const row = document.createElement('div');
    row.className = 'journal-line';
    if (logNewLines.has(line)) {
      row.classList.add('journal-line-new');
      logNewLines.delete(line);
    }
    const parsed = formatJournalTimestamp(displayLine, uiPreferences.journalTimeZone);
    const severity = splitJournalLevel(parsed?.message ?? displayLine, displayLine);
    row.dataset.level = severity.level === 'ERROR' || severity.level === 'FATAL' ? 'error'
      : severity.level === 'WARN' || severity.level === 'WARNING' ? 'warning'
        : severity.level === 'DEBUG' ? 'debug' : 'info';
    const timestamp = document.createElement('time');
    timestamp.className = 'journal-timestamp';
    timestamp.hidden = !parsed;
    timestamp.textContent = parsed?.timestamp ?? '';
    if (parsed) timestamp.dateTime = displayLine.match(/^(?:time=")?\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/)?.[1] ?? '';
    if (severity.level) {
      const badge = document.createElement('span');
      badge.className = 'journal-level-badge';
      badge.textContent = severity.level;
      row.append(timestamp, badge);
    } else row.append(timestamp);
    const message = document.createElement('code');
    for (const segment of formatJournalMessage(severity.message)) {
      if (!segment.tone) {
        message.append(document.createTextNode(segment.text));
        continue;
      }
      const highlight = document.createElement('span');
      highlight.className = `journal-message-${segment.tone}`;
      highlight.textContent = segment.text;
      message.append(highlight);
    }
    row.append(message);
    list.append(row);
  }
  body.replaceChildren();
  if (logData?.truncated) {
    const note = document.createElement('p');
    note.className = 'journal-truncated';
    note.textContent = 'Показан ограниченный хвост файла журнала.';
    body.append(note);
  }
  if (!lines.length) {
    const empty = document.createElement('div');
    empty.className = 'journal-empty';
    const icon = document.createElement('span');
    icon.className = 'journal-empty-icon';
    icon.textContent = '▤';
    const title = document.createElement('strong');
    title.textContent = filter ? 'Совпадений нет' : 'В выбранном журнале пока нет записей';
    const file = document.createElement('p');
    file.textContent = logData?.file ?? 'Ожидается ответ backend';
    empty.append(icon, title, file);
    body.append(empty);
  } else {
    body.append(list);
    list.scrollTop = getJournalScrollTop(previousScroll, list.scrollHeight, list.clientHeight);
  }
}

async function loadSystemLog(): Promise<void> {
  if (logLoading) return;
  logController?.abort();
  const controller = new AbortController();
  logController = controller;
  logLoading = true;
  let shouldRedraw = !logData;
  if (!logData) drawJournal();
  try {
    const previousLog = logData;
    const previousLines = previousLog?.lines ?? null;
    const fetchedLog = await getSystemLog(selectedLog, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    const nextLog = { ...fetchedLog, lines: hideClearedJournalLines(selectedLog, fetchedLog.lines) };
    shouldRedraw = hasJournalLinesChanged(previousLines, nextLog.lines)
      || previousLog?.file !== nextLog.file
      || previousLog?.truncated !== nextLog.truncated;
    logNewLines = new Set(previousLines ? getNewJournalLines(previousLines, nextLog.lines) : []);
    logData = nextLog;
    if (nextLog.lines.length > 0) logCleared = false;
    logError = null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (!logData) logError = error instanceof Error ? error.message : 'Не удалось загрузить журнал';
  } finally {
    if (logController === controller) {
      logLoading = false;
      if (shouldRedraw || !logData) drawJournal();
      if (logRefreshAfterCurrent) {
        logRefreshAfterCurrent = false;
        window.setTimeout(() => void loadSystemLog(), 0);
      }
    }
  }
}

function bindJournal(): void {
  if (!document.querySelector('.journal-panel')) return;
  const fileSelect = document.querySelector<HTMLSelectElement>('#journal-file');
  fileSelect?.addEventListener('change', () => {
    selectedLog = fileSelect.value;
    logController?.abort();
    logLoading = false;
    logData = null;
    logError = null;
    logCleared = false;
    void loadSystemLog();
  });
  document.querySelector<HTMLInputElement>('#journal-filter')?.addEventListener('input', (event) => {
    logFilter = (event.currentTarget as HTMLInputElement).value;
    drawJournal();
  });
  document.querySelector<HTMLButtonElement>('#journal-clear')?.addEventListener('click', () => {
    if (logData) rememberClearedJournal(selectedLog, logData.lines);
    logCleared = true;
    if (logData) logData = { ...logData, lines: [] };
    drawJournal();
  });
  document.querySelector<HTMLButtonElement>('#journal-expand')?.addEventListener('click', () => {
    logExpanded = !logExpanded;
    document.querySelector('.journal-panel')?.classList.toggle('is-expanded', logExpanded);
    const button = document.querySelector<HTMLButtonElement>('#journal-expand');
    if (button) {
      button.setAttribute('aria-pressed', String(logExpanded));
      const label = journalExpandLabel(logExpanded);
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = journalExpandIcon(logExpanded);
    }
  });
  drawJournal();
  if (!logData && !logError && !logLoading) void loadSystemLog();
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !logExpanded) return;
  logExpanded = false;
  document.querySelector('.journal-panel')?.classList.remove('is-expanded');
  const button = document.querySelector<HTMLButtonElement>('#journal-expand');
  if (button) {
    const label = journalExpandLabel(false);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = journalExpandIcon(false);
  }
});

async function mountConfigurationEditor(): Promise<void> {
  try {
    yamlEditorLoad ??= import('./yaml-editor');
    yamlEditorModule = await yamlEditorLoad;
    if (activePage === 'configuration') yamlEditorModule.mountYamlEditor(state.status?.mode === 'router', xkeenStatus?.core);
  } catch (error) {
    yamlEditorLoad = null;
    const status = document.querySelector<HTMLElement>('#yaml-validation');
    if (status) status.textContent = error instanceof Error ? `Не удалось загрузить редактор: ${error.message}` : 'Не удалось загрузить редактор конфигурации.';
  }
}

function render(): void {
  if (!app) return;
  const scrollTop = app.querySelector<HTMLElement>('.workspace-scroll')?.scrollTop ?? 0;
  const nestedScrollPositions = new Map<string, number>();
  for (const selector of ['.selector-list', '.connection-table-wrap', '.journal-lines']) {
    app.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      nestedScrollPositions.set(`${selector}:${index}`, element.scrollTop);
    });
  }
  if (activePage !== 'configuration') yamlEditorModule?.unmountYamlEditor();
  const pageContent = activePage === 'selectors' ? renderSelectors(visibleSelectors(), selectorsLoading, selectorsError)
    : activePage === 'connections' ? renderConnections(connections, connectionsLoading, connectionsError, uiPreferences.showConnectionSource, connectionSourceNames, connectionSort, collectConnectionProxyIcons(selectors))
      : activePage === 'dns' ? renderDns(dnsResult, dnsLoading, dnsError, dnsQueryName, dnsQueryType, {
          status: dnsManagementStatus, loading: dnsManagementLoading, error: dnsManagementError,
          busy: dnsManagementBusy, confirm: dnsManagementConfirm,
        }, { values: dnsConfig?.values ?? null, loading: dnsConfigLoading, error: dnsConfigError, busy: dnsConfigBusy })
        : renderComingSoon(activePage);
  const workspace = renderWorkspaceFrame(renderNavigation(), pageContent, `main-content${animatePageEntry ? ' page-enter' : ''}`, renderJournal());
  app.innerHTML = `<div class="app-shell">${renderHeader()}<div class="workspace-scroll">${workspace}</div><div class="toast-region" aria-live="polite"></div></div>`;
  bindDnsTextareaGrowth([...app.querySelectorAll<HTMLTextAreaElement>('.dns-settings-form textarea')]);
  animatePageEntry = false;
  updateAppUpdateNotice();
  app.querySelector<HTMLElement>('.workspace-scroll')!.scrollTop = scrollTop;
  for (const selector of ['.selector-list', '.connection-table-wrap', '.journal-lines']) {
    app.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      const previous = nestedScrollPositions.get(`${selector}:${index}`);
      if (previous !== undefined) element.scrollTop = previous;
    });
  }
  bindJournal();
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.page as Page | undefined;
      if (page && pages.some((item) => item.id === page)) {
        if (page !== 'dns') {
          dnsController?.abort();
          dnsLoading = false;
        }
        activePage = page;
        animatePageEntry = true;
        render();
        void loadMihomoPage(page);
        if (page === 'dns') {
          void loadRouterDnsStatus();
          void loadMihomoDnsConfig();
        }
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('#retry').forEach((button) => button.addEventListener('click', () => void refresh()));
  document.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', openSettings);
  document.querySelector<HTMLButtonElement>('#rulesets-open')?.addEventListener('click', () => void openRulesetsDialog());
  document.querySelector<HTMLButtonElement>('#subscriptions-open')?.addEventListener('click', () => void openSubscriptionsDialog());
  document.querySelector<HTMLButtonElement>('#app-version')?.addEventListener('click', () => void openAppReleases());
  document.querySelector<HTMLButtonElement>('#core-version')?.addEventListener('click', () => {
    const serviceFor = (name: string) => state.status?.services.find((service) => service.name.toLowerCase() === name);
    const managerState = (core: 'mihomo' | 'xray') => {
      const service = serviceFor(core);
      const configured = xkeenStatus?.installed === true && xkeenStatus.core === core;
      return {
        installed: Boolean((core === 'mihomo' ? mihomoVersion : service?.version) || service?.state === 'running' || configured),
        active: service?.state === 'running' || (configured && xkeenStatus?.running === true),
        version: core === 'mihomo' ? mihomoVersion ?? service?.version ?? null : service?.version ?? null,
      };
    };
    const open = () => openCoreManagerDialog({ mihomo: managerState('mihomo'), xray: managerState('xray') }, (core) => {
      const version = managerState(core).version;
      void openCoreReleaseDialog(core, async () => (await getCoreSources())[core], version, () => uiPreferences.keepCoreBackup);
    });
    open();
  });
  bindXkeenControls(app);
  bindDnsManagementControls(app);
  document.querySelector<HTMLFormElement>('#dns-query-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    dnsQueryName = String(data.get('name') ?? '').trim();
    dnsQueryType = String(data.get('type') ?? 'A');
    void runDnsQuery();
  });
  document.querySelector<HTMLFormElement>('#mihomo-dns-settings')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const settings: MihomoDnsSettings = {
      enhancedMode: data.get('enhancedMode') === 'fake-ip' ? 'fake-ip' : 'redir-host',
      bootstrap: String(data.get('bootstrap') ?? ''),
      nameserver: String(data.get('nameserver') ?? ''),
      nameserverPolicy: String(data.get('nameserverPolicy') ?? ''),
      proxyServerNameserver: String(data.get('proxyServerNameserver') ?? ''),
      fallback: String(data.get('fallback') ?? ''),
    };
    void saveMihomoDnsConfig(settings);
  });
  if (activePage === 'configuration') void mountConfigurationEditor();
  bindMihomoInteractions();
}

async function runXkeenAction(action: string | undefined): Promise<void> {
  if (action !== 'start' && action !== 'stop' && action !== 'restart') return;
  if (xkeenControlBusy || configApplyBusy) return;
  if (action === 'stop' && !(await confirmInApp('Остановить XKeen?',
    'Трафик через XKeen остановится. Если DNS передан Mihomo, остановка будет заблокирована.', 'Остановить'))) return;
  xkeenControlBusy = true;
  xkeenControlAction = action;
  selectedLog = 'xkeen-ui';
  logCleared = false;
  render();
  setJournalRealtime(true);
  void loadSystemLog();
  let actionError: string | undefined;
  try {
    xkeenStatus = await controlXkeen(action);
    if (action === 'start') await maybeEnableDnsAfterStart();
    await refresh();
  } catch (error) {
    actionError = error instanceof Error ? error.message : 'Не удалось выполнить команду XKeen';
    await refresh();
  } finally {
    xkeenControlBusy = false;
    xkeenControlAction = null;
    setJournalRealtime(false);
    const feedback = lifecycleFeedback(action, actionError);
    selectedLog = feedback.logFile;
    logController?.abort();
    logLoading = false;
    logData = null;
    logError = null;
    logCleared = false;
    render();
    void loadSystemLog();
    showToast(feedback.message, feedback.kind);
  }
}

async function maybeEnableDnsAfterStart(): Promise<void> {
  if (uiPreferences.dnsAutostart !== 'confirm' || state.status?.mode !== 'router') return;
  try {
    dnsManagementStatus = await getRouterDnsStatus();
    if (dnsManagementStatus.dnsOverride) return;
    const confirmed = await confirmInApp(
      'Передать DNS через Mihomo?',
      'KeeneticOS временно направит IPv4 DNS на Mihomo. Статические IPv6 DNS и DoH/DoT не меняются. Остановить XKeen при активной передаче DNS нельзя, пока вы не вернёте DNS KeeneticOS.',
      'Включить управление DNS',
    );
    if (!confirmed) return;
    const activeConfig = await getActiveMihomoConfig();
    patchDnsManagement(activeConfig.content, true);
    await setRouterDnsManagement({ enabled: true, expectedContent: activeConfig.content });
    dnsManagementStatus = await getRouterDnsStatus();
    showToast('Управление DNS Mihomo включено', 'success');
  } catch (error) {
    showToast(error instanceof Error ? `Автовключение DNS не выполнено: ${error.message}` : 'Автовключение DNS не выполнено', 'error');
  }
}

function bindXkeenControls(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('[data-xkeen-action]').forEach((button) => {
    button.addEventListener('click', () => void runXkeenAction(button.dataset.xkeenAction));
  });
}

function showToast(message: string, kind: 'success' | 'error' | 'info'): void {
  if (kind === 'error') {
    if (!shouldReportUiError(message, Date.now(), recentUiErrors)) return;
    void logUiError('ui', message).catch(() => undefined);
  }
  const region = document.querySelector<HTMLElement>('.toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

function updateAppUpdateNotice(): void {
  const region = document.querySelector<HTMLElement>('.toast-region');
  if (!region) return;
  region.querySelector('.update-toast')?.remove();
  if (!appUpdateAvailable || appUpdateNoticeDismissed) return;
  const template = document.createElement('template');
  template.innerHTML = renderAppUpdateNotice(appUpdateAvailable.tag_name, appUpdateAvailable.html_url);
  const notice = template.content.firstElementChild;
  if (!notice) return;
  region.append(notice);
  notice.querySelector<HTMLButtonElement>('[data-open-app-update]')?.addEventListener('click', () => void openAppReleases());
  notice.querySelector<HTMLButtonElement>('[data-dismiss-app-update]')?.addEventListener('click', () => {
    appUpdateNoticeDismissed = true;
    notice.remove();
  });
}

async function runDnsQuery(): Promise<void> {
  dnsController?.abort();
  const controller = new AbortController();
  dnsController = controller;
  dnsLoading = true;
  dnsError = null;
  render();
  try {
    dnsResult = await queryMihomoDns(dnsQueryName, dnsQueryType, controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    dnsError = error instanceof Error ? error.message : 'DNS-запрос завершился ошибкой';
    void logUiError('ui', `DNS lookup: ${dnsError}`).catch(() => undefined);
  } finally {
    if (!controller.signal.aborted) {
      dnsLoading = false;
      if (activePage === 'dns') render();
    }
  }
}

function bindDnsManagementControls(root: ParentNode): void {
  root.querySelector<HTMLInputElement>('#dns-management-toggle')?.addEventListener('change', () => {
    dnsManagementConfirm = true;
    render();
  });
  root.querySelector<HTMLButtonElement>('#dns-management-cancel')?.addEventListener('click', () => {
    dnsManagementConfirm = false;
    render();
  });
  root.querySelector<HTMLButtonElement>('#dns-management-apply')?.addEventListener('click', () => void runDnsManagementToggle());
}

async function loadRouterDnsStatus(force = false): Promise<void> {
  if (force) dnsStatusCache.invalidate();
  const cached = dnsStatusCache.peek();
  if (cached) {
    dnsManagementStatus = cached;
    if (activePage === 'dns') render();
    return;
  }
  const requestRevision = dnsStatusCache.currentRevision();
  dnsManagementLoading = true;
  dnsManagementError = null;
  render();
  try {
    const status = await dnsStatusCache.get(() => getRouterDnsStatus());
    if (dnsStatusCache.isCurrent(requestRevision)) dnsManagementStatus = status;
  } catch (error) {
    if (dnsStatusCache.isCurrent(requestRevision)) {
      dnsManagementError = error instanceof Error ? error.message : 'Не удалось прочитать состояние DNS';
      void logUiError('ui', `DNS status: ${dnsManagementError}`).catch(() => undefined);
    }
  } finally {
    if (dnsStatusCache.isCurrent(requestRevision)) {
      dnsManagementLoading = false;
      if (activePage === 'dns') render();
    }
  }
}

async function loadMihomoDnsConfig(): Promise<void> {
  dnsConfigLoading = true;
  dnsConfigError = null;
  render();
  try {
    const current = await getActiveMihomoConfig();
    dnsConfig = { content: current.content, values: readMihomoDnsSettings(current.content) };
  } catch (error) {
    dnsConfig = null;
    dnsConfigError = error instanceof Error ? error.message : 'Не удалось прочитать DNS-конфигурацию Mihomo';
    void logUiError('config', `DNS config load: ${dnsConfigError}`).catch(() => undefined);
  } finally {
    dnsConfigLoading = false;
    if (activePage === 'dns') render();
  }
}

async function saveMihomoDnsConfig(settings: MihomoDnsSettings): Promise<void> {
  if (!dnsConfig || dnsConfigBusy) return;
  dnsConfig = { ...dnsConfig, values: settings };
  dnsConfigBusy = true;
  dnsConfigError = null;
  render();
  try {
    const updated = patchMihomoDnsSettings(dnsConfig.content, settings);
    await applyActiveMihomoConfig(updated, dnsConfig.content);
    const current = await getActiveMihomoConfig();
    dnsConfig = { content: current.content, values: readMihomoDnsSettings(current.content) };
    await loadRouterDnsStatus(true);
    showToast('Настройки DNS Mihomo сохранены и применены', 'success');
  } catch (error) {
    dnsConfigError = error instanceof Error ? error.message : 'Не удалось применить настройки DNS Mihomo';
    showToast(dnsConfigError, 'error');
  } finally {
    dnsConfigBusy = false;
    if (activePage === 'dns') render();
  }
}

async function runDnsManagementToggle(): Promise<void> {
  const currentStatus = dnsManagementStatus;
  if (!currentStatus || dnsManagementBusy) return;
  const enabled = !currentStatus.dnsOverride;
  dnsManagementBusy = true;
  dnsManagementConfirm = false;
  dnsManagementError = null;
  render();
  let notice = '';
  let noticeKind: 'success' | 'error' = 'success';
  try {
    const activeConfig = await getActiveMihomoConfig();
    patchDnsManagement(activeConfig.content, enabled);
    await setRouterDnsManagement({ enabled, expectedContent: activeConfig.content });
    notice = enabled ? 'DNS Mihomo включён' : 'DNS возвращён KeeneticOS';
    try {
      await loadRouterDnsStatus(true);
    } catch (error) {
      dnsManagementStatus = null;
      dnsManagementError = error instanceof Error ? `Настройки применились, но состояние не обновилось: ${error.message}` : 'Настройки применились, но состояние не обновилось';
    }
    await loadMihomoDnsConfig();
  } catch (error) {
    dnsManagementError = error instanceof Error ? error.message : 'Не удалось изменить управление DNS';
    notice = dnsManagementError;
    noticeKind = 'error';
  } finally {
    dnsManagementBusy = false;
    if (activePage === 'dns') render();
    showToast(notice, noticeKind);
  }
}

function openConnectionDetails(id: string): void {
  const connection = connections?.connections.find((item) => item.id === id);
  if (!connection) return;
  const sourceName = uiPreferences.showConnectionSource && connection.sourceIp ? connectionSourceNames[connection.sourceIp] : undefined;
  const modal = document.createElement('dialog');
  modal.className = 'modal connection-details-dialog';
  modal.setAttribute('aria-labelledby', 'connection-details-title');
  modal.innerHTML = `<section class="modal-panel connection-details-panel"><header class="modal-heading"><h2 id="connection-details-title">Подробности соединения</h2><button class="icon-button" type="button" data-close-details aria-label="Закрыть подробности">×</button></header><div class="connection-details-body">${renderConnectionDetails(connection, sourceName)}</div></section>`;
  document.body.append(modal);
  bindDialogMotion(modal);
  modal.querySelector<HTMLButtonElement>('[data-close-details]')?.addEventListener('click', () => closeDialogWithMotion(modal));
  modal.addEventListener('close', () => modal.remove(), { once: true });
  modal.showModal();
}

function bindMihomoInteractions(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-inspect-connection]').forEach((button) => {
    button.addEventListener('click', () => openConnectionDetails(button.dataset.inspectConnection ?? ''));
  });
  document.querySelector<HTMLButtonElement>('#mihomo-retry')?.addEventListener('click', () => void loadMihomoPage(activePage));
  document.querySelectorAll<HTMLButtonElement>('.proxy-option-select').forEach((button) => {
    button.addEventListener('click', () => void selectProxyFromUi(button));
  });
  document.querySelectorAll<HTMLButtonElement>('.ping-group').forEach((button) => {
    button.addEventListener('click', () => void pingGroupFromUi(button));
  });
  document.querySelectorAll<HTMLButtonElement>('.proxy-ping-value').forEach((button) => {
    button.addEventListener('click', () => void pingProxyFromUi(button));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-close-connection]').forEach((button) => {
    button.addEventListener('click', () => void closeConnectionFromUi(button));
  });
  document.querySelector<HTMLButtonElement>('#close-all-connections')?.addEventListener('click', () => void closeAllConnectionsFromUi());
  document.querySelectorAll<HTMLButtonElement>('[data-connection-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.connectionSort;
      if (!key || !['route', 'host', 'network', 'source', 'traffic', 'start'].includes(key)) return;
      const typedKey = key as ConnectionSortKey;
      connectionSort = connectionSort.key === typedKey
        ? { key: typedKey, direction: connectionSort.direction === 'ascending' ? 'descending' : 'ascending' }
        : { key: typedKey, direction: typedKey === 'start' ? 'descending' : 'ascending' };
      const rows = new Map(Array.from(document.querySelectorAll<HTMLTableRowElement>('.connection-table tbody tr'), (row) => [row.dataset.connectionId ?? '', row]));
      const body = document.querySelector<HTMLTableSectionElement>('.connection-table tbody');
      if (body) {
        for (const connection of sortMihomoConnections(connections?.connections ?? [], connectionSort, uiPreferences.showConnectionSource ? connectionSourceNames : {})) {
          const row = rows.get(connection.id);
          if (row) body.append(row);
        }
      }
      document.querySelectorAll<HTMLTableCellElement>('.connection-table thead th[aria-sort]').forEach((heading) => {
        const headingButton = heading.querySelector<HTMLButtonElement>('[data-connection-sort]');
        const selected = headingButton?.dataset.connectionSort === connectionSort.key;
        heading.setAttribute('aria-sort', selected ? connectionSort.direction : 'none');
        const arrow = headingButton?.querySelector<HTMLElement>('span');
        if (arrow) arrow.textContent = selected ? (connectionSort.direction === 'ascending' ? '↑' : '↓') : '↕';
      });
    });
  });
  document.querySelector<HTMLInputElement>('#connection-filter')?.addEventListener('input', (event) => {
    const query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll<HTMLElement>('.connection-table tbody tr').forEach((row) => {
      const matches = row.dataset.search?.includes(query) ?? false;
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const noResults = document.querySelector<HTMLElement>('.connection-no-results.is-filtered');
    if (noResults) noResults.hidden = query.length === 0 || visible > 0;
  });
}

function updatePingControls(): void {
  const options = new Map(selectors.flatMap((group) => group.options).map((option) => [option.name, option]));
  document.querySelectorAll<HTMLButtonElement>('.proxy-ping-value').forEach((button) => {
    const option = options.get(button.dataset.pingProxy ?? '');
    if (!option) return;
    button.classList.toggle('is-alive', option.alive === true);
    button.classList.toggle('is-dead', option.alive === false);
    const pingLabel = option.alive === null ? 'Проверить ping' : option.alive ? 'Узел отвечает' : 'Узел не отвечает';
    button.title = `${option.alive === null ? 'Проверка недоступна' : pingLabel}. Нажмите, чтобы проверить ping`;
    button.setAttribute('aria-label', `${pingLabel}. Нажмите, чтобы повторить ping узла ${option.name}`);
    const icon = button.querySelector('.ping-status-icon');
    if (icon) icon.outerHTML = renderPingStatusIcon(option.alive);
    const value = button.querySelector('span');
    if (value) value.textContent = option.alive === true && option.delay !== null ? String(option.delay) : '';
  });
}

async function pingGroupFromUi(button: HTMLButtonElement): Promise<void> {
  const group = button.dataset.pingGroup;
  if (!group || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-pinging');
  button.setAttribute('aria-busy', 'true');
  button.textContent = '…';
  try {
    const results = await pingMihomoGroup(group, currentPingOptions(), mihomoController?.signal);
    updatePingFailures(group, results);
    selectors = applyPingResults(selectors, results);
    updatePingControls();
    if (uiPreferences.hideUnavailableProxies && activePage === 'selectors') render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    button.title = error instanceof Error ? error.message : 'Не удалось проверить серверы';
  } finally {
    button.disabled = false;
    button.classList.remove('is-pinging');
    button.removeAttribute('aria-busy');
    button.textContent = 'ϟ';
  }
}

async function pingProxyFromUi(button: HTMLButtonElement): Promise<void> {
  const group = button.dataset.pingGroup;
  const name = button.dataset.pingProxy;
  if (!group || !name || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-pinging');
  button.setAttribute('aria-busy', 'true');
  const value = button.querySelector('span');
  if (value) value.textContent = '…';
  try {
    const result = await pingMihomoProxy(group, name, currentPingOptions(), mihomoController?.signal);
    if (result) {
      updatePingFailures(group, [result]);
      selectors = applyPingResults(selectors, [result]);
    }
    updatePingControls();
    if (result && uiPreferences.hideUnavailableProxies && activePage === 'selectors') render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    button.title = error instanceof Error ? error.message : 'Не удалось проверить узел';
  } finally {
    button.disabled = false;
    button.classList.remove('is-pinging');
    button.removeAttribute('aria-busy');
    const latest = selectors.flatMap((selector) => selector.options).find((option) => option.name === name)?.delay;
    if (value?.isConnected) value.textContent = latest === null || latest === undefined ? '—' : `${latest} мс`;
  }
}

function currentPingOptions(): { url: string; timeoutMs: number } {
  return { url: `${uiPreferences.pingScheme}://${uiPreferences.pingUrl}`, timeoutMs: uiPreferences.pingTimeoutMs };
}

function updatePingFailures(group: string, results: Array<{ name: string; delay: number | null }>): void {
  for (const result of results) {
    const key = `${group}\u0000${result.name}`;
    proxyPingFailures.set(key, result.delay === null ? (proxyPingFailures.get(key) ?? 0) + 1 : 0);
  }
}

function visibleSelectors(): MihomoSelector[] {
  return selectors.map((group) => {
    let options = group.options;
    if (uiPreferences.hideUnavailableProxies) {
      options = options.filter((option) => (proxyPingFailures.get(`${group.name}\u0000${option.name}`) ?? 0) < uiPreferences.unavailableThreshold);
    }
    if (uiPreferences.selectorSort === 'name') options = [...options].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (uiPreferences.selectorSort === 'delay') options = [...options].sort((a, b) => (a.delay ?? Number.MAX_SAFE_INTEGER) - (b.delay ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'ru'));
    return { ...group, options };
  });
}

async function closeConnectionFromUi(button: HTMLButtonElement): Promise<void> {
  const id = button.dataset.closeConnection;
  if (!id || button.disabled) return;
  button.disabled = true;
  try {
    await closeMihomoConnection(id, mihomoController?.signal);
    await loadMihomoPage('connections');
    showToast('Mihomo закрыл соединение. Если оно появится снова, клиент открыл его повторно.', 'success');
  } catch (error) {
    connectionsError = error instanceof Error ? error.message : 'Не удалось закрыть соединение';
    connectionsLoading = false;
    render();
  }
}

async function closeAllConnectionsFromUi(): Promise<void> {
  const count = connections?.connections.length ?? 0;
  if (!count) return;
  const button = document.querySelector<HTMLButtonElement>('#close-all-connections');
  if (button) { button.disabled = true; button.textContent = 'Закрываем…'; }
  try {
    await closeAllMihomoConnections(mihomoController?.signal);
    await loadMihomoPage('connections');
    showToast('Mihomo закрыл активные соединения. Клиенты могут открыть новые.', 'success');
  } catch (error) {
    connectionsError = error instanceof Error ? error.message : 'Не удалось закрыть соединения';
    connectionsLoading = false;
    render();
  }
}

async function autoCloseConnectionsAfterApply(): Promise<void> {
  if (!uiPreferences.closeConnectionsAfterApply) return;
  try {
    await closeAllMihomoConnections();
    if (activePage === 'connections') await loadMihomoPage('connections');
    showToast('Соединения закрыты после применения конфигурации', 'success');
  } catch (error) {
    showToast(error instanceof Error ? `Не удалось закрыть соединения: ${error.message}` : 'Не удалось закрыть соединения после применения', 'error');
  }
}

async function loadMihomoPage(page: Page): Promise<void> {
  if (page !== 'selectors' && page !== 'connections') return;
  const hadData = page === 'selectors' ? selectors.length > 0 : connections !== null;
  mihomoController?.abort();
  mihomoController = new AbortController();
  const { signal } = mihomoController;
  if (!mihomoVersion) {
    void getMihomoVersion(signal).then((version) => {
      if (signal.aborted) return;
      mihomoVersion = version;
      if (activePage === page) updateChrome();
    }).catch(() => undefined);
  }
  if (page === 'selectors') { selectorsLoading = !hadData; selectorsError = null; }
  else if (page === 'connections') { connectionsLoading = !hadData; connectionsError = null; }
  if (activePage === page && !hadData) render();
  try {
    if (page === 'selectors') {
      const [groups, config] = await Promise.all([
        getMihomoSelectors(signal),
        getActiveMihomoConfig(signal).catch(() => null),
      ]);
      if (signal.aborted) return;
      selectors = config ? orderSelectorsByConfig(groups, config.content) : groups;
    }
    else if (page === 'connections') {
      connections = await getMihomoConnections(signal);
      if (uiPreferences.showConnectionSource) refreshConnectionSourceNames(connections, signal);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка API Mihomo';
    if (page === 'selectors') selectorsError = hadData ? null : message;
    else if (page === 'connections') connectionsError = hadData ? null : message;
    if (hadData) showToast(`Данные не обновились: ${message}`, 'error');
  } finally {
    if (!signal.aborted) {
      if (page === 'selectors') selectorsLoading = false;
      else if (page === 'connections') connectionsLoading = false;
      if (activePage === page) render();
    }
  }
}

function refreshConnectionSourceNames(data: MihomoConnections, signal: AbortSignal): void {
  const ips = data.connections.map((connection) => connection.sourceIp || '');
  void sourceNameResolver.resolve(ips).then((names) => {
    if (signal.aborted) return;
    connectionSourceNames = names;
    if (activePage === 'connections') render();
  });
}

async function selectProxyFromUi(button: HTMLButtonElement): Promise<void> {
  const group = button.dataset.proxyGroup;
  const name = button.dataset.proxyName;
  if (button.getAttribute('aria-current') === 'true') return;
  if (!group || !name) return;
  const previous = selectors;
  const updated = selectProxyOptimistically(previous, group, name);
  if (updated === previous) return;
  if (!confirmedSelectorSelections.has(group)) confirmedSelectorSelections.set(group, previous.find((item) => item.name === group)?.current ?? null);
  const confirmedBeforeRequest = confirmedSelectorSelections.get(group) ?? null;
  const version = (selectorSelectionVersions.get(group) ?? 0) + 1;
  selectorSelectionVersions.set(group, version);
  selectors = updated;
  selectorsError = null;
  updateSelectorSelectionInDom(group, name);
  const request = queueSelectorWrite(selectorSelectionQueues, group, () => selectMihomoProxy(group, name), () => {
    confirmedSelectorSelections.set(group, name);
    if (selectorSelectionVersions.get(group) === version) void closeSelectorConnectionsAfterSwitch(group, version);
  });
  void request.catch((error: unknown) => {
    if (selectorSelectionVersions.get(group) !== version) return;
    const acceptedPriorSelection = confirmedSelectorSelections.get(group) !== confirmedBeforeRequest;
    const confirmed = confirmedSelectorSelections.get(group) ?? null;
    selectors = restoreProxySelection(selectors, group, confirmed);
    selectorsError = error instanceof Error ? error.message : 'Не удалось выбрать узел';
    updateSelectorSelectionInDom(group, confirmed ?? '');
    if (activePage === 'selectors') render();
    showToast(`Не удалось выбрать узел: ${selectorsError}`, 'error');
    if (acceptedPriorSelection) void closeSelectorConnectionsAfterSwitch(group, version);
  });
}

async function closeSelectorConnectionsAfterSwitch(group: string, version: number): Promise<void> {
  try {
    const activeConnections = await getMihomoConnections();
    if (selectorSelectionVersions.get(group) !== version) return;
    const affectedIds = getAffectedConnectionIds(activeConnections.connections, group);
    await Promise.all(affectedIds.map((id) => closeMihomoConnection(id)));
    if (selectorSelectionVersions.get(group) !== version) return;
    if (connections) connections = { ...connections, connections: connections.connections.filter((connection) => !affectedIds.includes(connection.id)) };
    if (activePage === 'connections' && affectedIds.length > 0) await loadMihomoPage('connections');
  } catch (error) {
    if (selectorSelectionVersions.get(group) !== version) return;
    showToast(error instanceof Error ? `Узел выбран, но активные соединения обновить не удалось: ${error.message}` : 'Узел выбран, но активные соединения не удалось обновить', 'error');
  }
}

function updateSelectorSelectionInDom(group: string, name: string): void {
  document.querySelectorAll<HTMLButtonElement>('.proxy-option-select').forEach((option) => {
    if (option.dataset.proxyGroup !== group) return;
    const selected = option.dataset.proxyName === name;
    const card = option.closest<HTMLElement>('.proxy-option');
    card?.classList.toggle('is-selected', selected);
    if (selected) option.setAttribute('aria-current', 'true');
    else option.removeAttribute('aria-current');
    const displayName = option.querySelector<HTMLElement>('.proxy-option-name')?.textContent?.trim() ?? option.dataset.proxyName ?? '';
    option.setAttribute('aria-label', `${selected ? 'Текущий узел' : 'Выбрать узел'}: ${displayName}`);
  });
  document.querySelectorAll<HTMLElement>('.selector-card[data-selector-card]').forEach((card) => {
    const selectedGroup = selectors.find((item) => item.name === card.dataset.selectorCard);
    const destination = card.querySelector<HTMLElement>('[data-selector-destination]');
    if (!selectedGroup || !destination) return;
    const html = renderSelectorDestination(selectedGroup, selectors);
    const template = document.createElement('template');
    template.innerHTML = html;
    const text = template.content.textContent ?? '';
    destination.innerHTML = html;
    destination.dataset.selectorDestination = text;
    destination.closest<HTMLElement>('.selector-destination')?.setAttribute('title', `Маршрут: ${text}`);
  });
}

function updateChrome(): void {
  const header = document.querySelector<HTMLElement>('.topbar');
  if (header) {
    const template = document.createElement('template');
    template.innerHTML = renderHeader();
    const nextHeader = template.content.firstElementChild as HTMLElement | null;
    if (nextHeader) {
      const setText = (selector: string) => {
        const current = header.querySelector<HTMLElement>(selector);
        const next = nextHeader.querySelector<HTMLElement>(selector);
        if (current && next && current.textContent !== next.textContent) current.textContent = next.textContent;
      };
      const currentLed = header.querySelector<HTMLElement>('#status-led');
      const nextLed = nextHeader.querySelector<HTMLElement>('#status-led');
      if (currentLed && nextLed && currentLed.className !== nextLed.className) currentLed.className = nextLed.className;
      setText('#service-label');
      const currentSummary = header.querySelector<HTMLElement>('#service-summary');
      const nextSummary = nextHeader.querySelector<HTMLElement>('#service-summary');
      if (currentSummary && nextSummary && currentSummary.innerHTML !== nextSummary.innerHTML) currentSummary.innerHTML = nextSummary.innerHTML;
      setText('#core-version-label');
      setText('#app-version-label');
      const currentAppVersion = header.querySelector<HTMLButtonElement>('#app-version');
      const nextAppVersion = nextHeader.querySelector<HTMLButtonElement>('#app-version');
      if (currentAppVersion && nextAppVersion) {
        currentAppVersion.classList.toggle('is-update-available', nextAppVersion.classList.contains('is-update-available'));
        currentAppVersion.title = nextAppVersion.title;
        currentAppVersion.setAttribute('aria-label', nextAppVersion.getAttribute('aria-label') ?? 'Обновить XKeen UI');
      }
      header.querySelector('.top-status-cluster')?.classList.toggle('is-xkeen-busy', xkeenControlBusy || configApplyBusy);
      const currentControls = header.querySelector<HTMLElement>('.header-service-controls');
      const nextControls = nextHeader.querySelector<HTMLElement>('.header-service-controls');
      if (currentControls && nextControls) {
        currentControls.setAttribute('aria-busy', nextControls.getAttribute('aria-busy') ?? 'false');
        if (currentControls.innerHTML !== nextControls.innerHTML) {
          currentControls.innerHTML = nextControls.innerHTML;
          bindXkeenControls(currentControls);
        }
      }
    }
  }
}

async function openAppReleases(): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal app-release-dialog';
  dialog.innerHTML = `<div class="modal-panel app-releases-panel"><div class="modal-heading"><svg class="modal-download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v4h16v-4"/></svg><h2>Обновление XKeen UI</h2><button class="icon-button" id="app-releases-close" type="button" aria-label="Закрыть">×</button></div><div class="core-release-dialog-source"><span>rangerxxyy/XKeen-UI</span><span class="core-release-github">GitHub</span></div><p class="modal-note" id="app-releases-status" aria-live="polite">Загружаем последние стабильные сборки…</p><div id="app-release-list" class="app-release-list" aria-label="Стабильные релизы XKeen UI"></div>${renderAppReleaseActions()}</div>`;
  document.body.append(dialog);
  bindDialogMotion(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector<HTMLButtonElement>('#app-releases-close')?.addEventListener('click', () => closeDialogWithMotion(dialog));
  const status = dialog.querySelector<HTMLElement>('#app-releases-status')!;
  const list = dialog.querySelector<HTMLElement>('#app-release-list')!;
  const install = dialog.querySelector<HTMLButtonElement>('#app-release-install')!;
  const choose = () => {
    appRelease = appReleases.find((release) => release.tag_name === list.querySelector<HTMLElement>('.app-release-card.is-selected')?.dataset.releaseTag) ?? null;
    const installed = state.status?.appVersion ?? APP_VERSION;
    const downgrade = appRelease ? isInstalledNewerOrEqual(installed, appRelease.tag_name) && !isInstalledNewerOrEqual(appRelease.tag_name, installed) : false;
    install.disabled = !appRelease || state.status?.mode !== 'router' || appUpdateInstalling || downgrade;
    install.textContent = downgrade ? 'Выбрана версия старее установленной'
      : 'Установить';
  };
  list.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>('.app-release-card');
    if (!card) return;
    list.querySelectorAll('.app-release-card').forEach((item) => item.classList.toggle('is-selected', item === card));
    list.querySelectorAll('.app-release-card').forEach((item) => item.setAttribute('aria-pressed', String(item === card)));
    choose();
  });
  install.addEventListener('click', async () => {
    if (appRelease && await confirmInApp('Установить XKeen UI?', `Версия ${appRelease.tag_name}. Панель перезапустится после установки.`, 'Установить')) {
      install.disabled = true;
      install.textContent = 'Устанавливаем…';
      void installAppUpdate();
    }
  });
  try {
    appReleases = await listAppReleases();
    if (!appReleases.length) throw new Error('Стабильные ARM64-релизы не найдены.');
    const installed = `v${(state.status?.appVersion ?? APP_VERSION).replace(/^v/i, '')}`;
    list.innerHTML = appReleases.map((release, index) => {
      const title = release.name?.trim() || release.tag_name;
      const date = release.published_at ? new Date(release.published_at).toLocaleDateString('ru-RU') : 'дата не указана';
      const notes = (release.body ?? '').trim().slice(0, 1800);
      return `<button type="button" class="app-release-card${index === 0 ? ' is-selected' : ''}" data-release-tag="${escapeHtml(release.tag_name)}" aria-pressed="${index === 0}"><span class="app-release-card-heading"><strong>${escapeHtml(title)}</strong><span class="app-release-radio" aria-hidden="true"></span></span><span class="app-release-date">${escapeHtml(release.tag_name === installed ? `${date} · установлена` : date)}</span>${notes ? `<span class="app-release-notes">${formatAppReleaseNotes(notes)}</span>` : ''}</button>`;
    }).join('');
    status.textContent = `Выберите версию · установлена ${installed}`;
    appRelease = appReleases[0] ?? null;
    choose();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Не удалось загрузить релизы.';
  }
}

function isInstalledNewerOrEqual(installed: string, selected: string): boolean {
  const parts = (value: string) => value.replace(/^v/, '').split('.').map(Number);
  const current = parts(installed);
  const target = parts(selected);
  for (let i = 0; i < 3; i += 1) {
    if ((current[i] ?? 0) !== (target[i] ?? 0)) return (current[i] ?? 0) > (target[i] ?? 0);
  }
  return true;
}

function openSettings(): void {
  const modal = document.createElement('dialog');
  modal.className = 'modal settings-dialog';
  modal.innerHTML = `<div class="modal-panel settings-panel"><div class="modal-heading"><span class="modal-icon">⚙</span><h2>Настройки</h2><button class="icon-button" id="settings-close" type="button" aria-label="Закрыть">×</button></div><div class="modal-tabs" role="tablist" aria-label="Разделы настроек">${SETTINGS_TABS.map(({ id, label }, index) => `<button class="settings-tab${index === 0 ? ' selected' : ''}" id="settings-${id}" type="button" role="tab" aria-controls="settings-content" aria-selected="${index === 0}">${label}</button>`).join('')}</div><div id="settings-content" role="tabpanel"></div></div>`;
  document.body.append(modal);
  bindDialogMotion(modal);
  modal.showModal();
  modal.querySelector<HTMLButtonElement>('#settings-close')?.addEventListener('click', () => closeDialogWithMotion(modal));
  const content = modal.querySelector<HTMLElement>('#settings-content');
  let githubProxies: string[] = [];
  let settingsLoaders: SettingsLoader[] = [];
  const renderProxyRows = () => {
    const list = modal.querySelector<HTMLElement>('#github-proxy-list');
    if (!list) return;
    list.innerHTML = githubProxies.length ? githubProxies.map((proxy, index) => `<div class="github-proxy-row"><input type="url" data-proxy-index="${index}" value="${escapeHtml(proxy)}" aria-label="GitHub-прокси ${index + 1}"><button class="editor-button github-proxy-delete" type="button" data-proxy-delete="${index}">Удалить</button></div>`).join('') : '<p class="settings-inline-note">Список пуст. Обновление будет загружаться напрямую.</p>';
    list.querySelectorAll<HTMLInputElement>('[data-proxy-index]').forEach((input) => input.addEventListener('input', () => {
      const index = Number(input.dataset.proxyIndex);
      if (Number.isInteger(index) && index >= 0 && index < githubProxies.length) githubProxies[index] = input.value;
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-proxy-delete]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.proxyDelete);
      if (Number.isInteger(index) && index >= 0 && index < githubProxies.length) {
        githubProxies.splice(index, 1);
        renderProxyRows();
      }
    }));
  };
  const renderSettingsTab = (tab: SettingsTabId) => {
    settingsLoaders.forEach((loader) => loader.dispose());
    settingsLoaders = [];
    modal.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
      const selected = button.id === `settings-${tab}`;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (!content) return;
    content.setAttribute('aria-labelledby', `settings-${tab}`);
    if (tab === 'general') {
      content.innerHTML = `<section class="settings-section"><h3>ВНЕШНИЙ ВИД И ЖУРНАЛ</h3><label class="setting-row setting-control-row"><span><strong>Тема</strong><small>Стандартная тема — тёмная. Выбор сохраняется в этом браузере.</small></span><select class="setting-control" data-pref="theme"><option value="light" ${uiPreferences.theme === 'light' ? 'selected' : ''}>Светлая</option><option value="dark" ${uiPreferences.theme === 'dark' ? 'selected' : ''}>Тёмная</option></select></label><label class="setting-row setting-control-row"><span><strong>Часовой пояс журнала</strong><small>Показывает время в выбранном часовом поясе. Записи без часового пояса остаются как есть.</small></span><select class="setting-control" data-pref="journalTimeZone"><option value="local" ${uiPreferences.journalTimeZone === 'local' ? 'selected' : ''}>Системный</option>${Array.from({ length: 27 }, (_, index) => index - 12).map((offset) => { const value = `UTC${offset >= 0 ? '+' : ''}${offset}`; return `<option value="${value}" ${uiPreferences.journalTimeZone === value ? 'selected' : ''}>${value}</option>`; }).join('')}</select></label></section><section class="settings-section"><h3>СОЕДИНЕНИЯ</h3>${switchRow('closeConnectionsAfterApply', 'Закрывать соединения после применения', 'Закрывает активные подключения после успешного применения конфигурации Mihomo.')}</section><section class="settings-section"><h3>DNS</h3><label class="setting-row setting-control-row"><span><strong>Автовключение управления DNS</strong><small>При запуске XKeen запросить подтверждение и передать DNS через Mihomo</small></span><select class="setting-control" data-pref="dnsAutostart"><option value="off" ${uiPreferences.dnsAutostart === 'off' ? 'selected' : ''}>Выключено</option><option value="confirm" ${uiPreferences.dnsAutostart === 'confirm' ? 'selected' : ''}>Включать с подтверждением</option></select></label></section>`;
      bindPreferenceInputs(content);
      return;
    }
    if (tab === 'mihomo') {
      content.innerHTML = `<section class="settings-section"><h3>СЕЛЕКТОРЫ</h3>${switchRow('hideUnavailableProxies', 'Скрывать недоступные подключения', 'Скрывает узлы из списка после указанного числа неудачных проверок. Конфигурация не меняется.')}${numberRow('unavailableThreshold', 'Порог таймаутов', 'Число неудачных проверок подряд для скрытия узла (1–10).', 1, 10)}<div class="setting-row setting-control-row"><span><strong>Сортировка</strong><small>Меняет только порядок узлов в панели. Автовыбор в группе fallback остаётся прежним.</small></span>${renderSelectorSortControl(uiPreferences.selectorSort)}</div></section><section class="settings-section"><h3>ПРОВЕРКА PING</h3><div class="setting-row setting-control-row"><span><strong>URL ping</strong><small>Введите адрес без http:// или https://. Mihomo проверит его через выбранный узел.</small></span><div class="setting-inline-controls"><select class="setting-control setting-scheme" data-pref="pingScheme" aria-label="Протокол ping"><option value="https" ${uiPreferences.pingScheme === 'https' ? 'selected' : ''}>https</option><option value="http" ${uiPreferences.pingScheme === 'http' ? 'selected' : ''}>http</option></select>${renderPingUrlControl(uiPreferences.pingUrl)}</div></div>${numberRow('pingTimeoutMs', 'Таймаут', 'Сколько ждать ответ при ручной проверке. Например, 5000 мс — 5 секунд.', 500, 30000, 'мс')}</section><section class="settings-section"><h3>СОЕДИНЕНИЯ</h3>${switchRow('showConnectionSource', 'Показывать имя источника', 'Показывает имя устройства из KeeneticOS вместо IP-адреса. Требуется доступ к списку устройств RCI; если имя не найдено, остаётся IP.')}</section>`;
      bindPreferenceInputs(content);
      bindSelectorSortControl(content);
      bindPingUrlControl(content);
      return;
    }
    if (tab === 'sources') {
      content.innerHTML = `<section class="settings-section"><h3>АВТОПРОВЕРКА</h3>${switchRow('autoCheckPanel', 'Автопроверка панели', 'Проверяет наличие новой версии раз в 4 часа, пока эта вкладка открыта.')}${switchRow('autoCheckCore', 'Автопроверка ядер', 'Проверяет релизы установленных ядер раз в 4 часа, пока эта вкладка открыта.')}${switchRow('keepCoreBackup', 'Резервная копия ядра', 'Хранить прежний бинарник для последующего отката. На время обновления временная копия для защиты всё равно создаётся.')}</section><section class="settings-section"><h3>ИСТОЧНИКИ ОБНОВЛЕНИЙ</h3>
        <label class="source-field"><span><strong>Источник Xray</strong><small>Формат: github.com/владелец/репозиторий</small></span><input id="source-xray" type="url" autocomplete="url" placeholder="https://github.com/XTLS/Xray-core"></label>
        <label class="source-field"><span><strong>Источник релизов Mihomo</strong><small>Можно указать репозиторий установленного форка или другой GitHub-репозиторий</small></span><select id="source-mihomo-preset"><option value="official">Оригинальный Mihomo · MetaCubeX</option><option value="prizrak">Prizrak-Core</option><option value="custom">Другой форк</option></select></label>
        <label class="source-field"><span><strong>Репозиторий</strong><small>Проверка релизов использует это значение; сохранение не заменяет установленное ядро</small></span><input id="source-mihomo" type="url" autocomplete="url" placeholder="https://github.com/MetaCubeX/mihomo"></label>
        <div class="source-save-row"><span class="sources-feedback" id="sources-feedback" aria-live="polite">Загружаем сохранённые значения…</span><button class="editor-button editor-button-primary" type="button" id="save-core-sources">Сохранить источники</button></div></section><section class="settings-section github-proxy-settings"><h3>GITHUB PROXY</h3><p class="settings-inline-note">Прокси используются по порядку сверху вниз при недоступности GitHub. Оставьте список пустым, чтобы загружать обновление напрямую.</p><div id="github-proxy-list"><p class="settings-inline-note">Загружаем сохранённый список…</p></div><div class="github-proxy-add-row"><input id="github-proxy-new" type="url" placeholder="https://proxy.example" autocomplete="url"><button class="editor-button" type="button" id="github-proxy-add">Добавить</button></div><div class="source-save-row"><span class="sources-feedback" id="github-proxy-feedback" aria-live="polite">Список хранится на роутере.</span><button class="editor-button editor-button-primary" type="button" id="github-proxy-save">Сохранить прокси</button></div></section>`;
      const xrayInput = content.querySelector<HTMLInputElement>('#source-xray');
      const mihomoInput = content.querySelector<HTMLInputElement>('#source-mihomo');
      const mihomoPreset = content.querySelector<HTMLSelectElement>('#source-mihomo-preset');
      const feedback = content.querySelector<HTMLElement>('#sources-feedback');
      const coreSave = content.querySelector<HTMLButtonElement>('#save-core-sources');
      const proxySave = content.querySelector<HTMLButtonElement>('#github-proxy-save');
      const retryButton = (id: string, before: HTMLElement | null) => {
        const button = document.createElement('button');
        button.id = id;
        button.className = 'editor-button';
        button.type = 'button';
        button.textContent = 'Повторить загрузку';
        button.hidden = true;
        before?.before(button);
        return button;
      };
      const coreRetry = retryButton('retry-core-sources', coreSave);
      const proxyRetry = retryButton('retry-github-proxies', proxySave);
      const coreControls = content.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#source-xray,#source-mihomo,#source-mihomo-preset,#save-core-sources,[data-core-release]');
      const coreLoader = createSettingsLoader(getCoreSources, (sources) => {
        if (xrayInput) xrayInput.value = sources.xray;
        if (mihomoInput) mihomoInput.value = sources.mihomo;
        if (mihomoPreset) mihomoPreset.value = sources.mihomo === 'https://github.com/MetaCubeX/mihomo'
          ? 'official' : sources.mihomo === 'https://github.com/legiz-ru/Prizrak-Core' ? 'prizrak' : 'custom';
      }, (phase, error) => {
        coreControls.forEach((control) => { control.disabled = phase !== 'ready'; });
        coreRetry.hidden = phase !== 'error';
        if (feedback) feedback.textContent = phase === 'loading' ? 'Загружаем сохранённые значения…'
          : phase === 'ready' ? '' : `Сохранение недоступно до загрузки. ${error}`;
      });
      const proxyFeedback = content.querySelector<HTMLElement>('#github-proxy-feedback');
      const proxyControls = () => content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#github-proxy-list input,#github-proxy-list button,#github-proxy-new,#github-proxy-add,#github-proxy-save');
      const proxyLoader = createSettingsLoader(getUpdateProxies, (settings) => {
        githubProxies = [...settings.proxies];
        renderProxyRows();
      }, (phase, error) => {
        proxyControls().forEach((control) => { control.disabled = phase !== 'ready'; });
        proxyRetry.hidden = phase !== 'error';
        const list = content.querySelector<HTMLElement>('#github-proxy-list');
        if (phase !== 'ready' && list) {
          const note = document.createElement('p');
          note.className = 'settings-inline-note';
          note.textContent = phase === 'loading' ? 'Загружаем сохранённый список…' : 'Список прокси не загружен. Повторите попытку.';
          list.replaceChildren(note);
        }
        if (proxyFeedback) proxyFeedback.textContent = phase === 'loading' ? 'Получаем список с роутера…'
          : phase === 'ready' ? 'Список загружен с роутера.' : `Изменения отключены до загрузки. ${error}`;
      });
      settingsLoaders = [coreLoader, proxyLoader];
      coreRetry.addEventListener('click', async () => {
        await coreLoader.load();
        if (!coreRetry.isConnected) return;
        if (coreLoader.ready) xrayInput?.focus();
        else coreRetry.focus();
      });
      proxyRetry.addEventListener('click', async () => {
        await proxyLoader.load();
        if (!proxyRetry.isConnected) return;
        if (proxyLoader.ready) content.querySelector<HTMLInputElement>('#github-proxy-new')?.focus();
        else proxyRetry.focus();
      });
      void coreLoader.load();
      void proxyLoader.load();
      mihomoPreset?.addEventListener('change', () => {
        if (mihomoPreset.value === 'official' && mihomoInput) mihomoInput.value = 'https://github.com/MetaCubeX/mihomo';
        if (mihomoPreset.value === 'prizrak' && mihomoInput) mihomoInput.value = 'https://github.com/legiz-ru/Prizrak-Core';
      });
      mihomoInput?.addEventListener('input', () => {
        if (mihomoPreset && !['https://github.com/MetaCubeX/mihomo', 'https://github.com/legiz-ru/Prizrak-Core'].includes(mihomoInput.value.trim().replace(/\/$/, ''))) mihomoPreset.value = 'custom';
      });
      content.querySelector<HTMLButtonElement>('#save-core-sources')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        if (!coreLoader.ready || !xrayInput || !mihomoInput || !feedback || button.disabled) return;
        coreControls.forEach((control) => { control.disabled = true; });
        feedback.textContent = 'Сохраняем…';
        try {
          const saved: CoreSources = await saveCoreSources({ xray: xrayInput.value, mihomo: mihomoInput.value });
          if (!button.isConnected) return;
          xrayInput.value = saved.xray;
          mihomoInput.value = saved.mihomo;
          feedback.textContent = 'Источники ядер сохранены.';
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : 'Не удалось сохранить настройки.';
        } finally {
          coreControls.forEach((control) => { control.disabled = !coreLoader.ready; });
        }
      });
      content.querySelector<HTMLButtonElement>('#github-proxy-add')?.addEventListener('click', () => {
        if (!proxyLoader.ready) return;
        const input = content.querySelector<HTMLInputElement>('#github-proxy-new');
        const value = input?.value.trim();
        if (!input || !value) return;
        if (githubProxies.length >= 5) {
          input.setCustomValidity('Можно добавить не более пяти прокси.');
          input.reportValidity();
          return;
        }
        input.setCustomValidity('');
        githubProxies.push(value);
        input.value = '';
        renderProxyRows();
      });
      content.querySelector<HTMLButtonElement>('#github-proxy-save')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        if (!proxyLoader.ready || !proxyFeedback || button.disabled) return;
        proxyControls().forEach((control) => { control.disabled = true; });
        proxyFeedback.textContent = 'Сохраняем список на роутере…';
        try {
          const saved = await saveUpdateProxies({ proxies: githubProxies });
          if (!button.isConnected) return;
          githubProxies = [...saved.proxies];
          renderProxyRows();
          proxyFeedback.textContent = 'Список GitHub-прокси сохранён на роутере.';
        } catch (error) {
          proxyFeedback.textContent = error instanceof Error ? error.message : 'Не удалось сохранить прокси.';
        } finally {
          if (button.isConnected) proxyControls().forEach((control) => { control.disabled = !proxyLoader.ready; });
        }
      });
      return;
    }

  };
  SETTINGS_TABS.forEach(({ id }) => {
    modal.querySelector<HTMLButtonElement>(`#settings-${id}`)?.addEventListener('click', () => renderSettingsTab(id));
  });
  renderSettingsTab('general');
  modal.addEventListener('close', () => { settingsLoaders.forEach((loader) => loader.dispose()); modal.remove(); render(); }, { once: true });
}

function switchRow(key: keyof UiPreferences, title: string, description: string): string {
  const checked = Boolean(uiPreferences[key]);
  return `<label class="setting-row setting-switch-row"><span><strong>${title}</strong><small>${description}</small></span><input class="setting-switch" data-pref="${key}" type="checkbox" ${checked ? 'checked' : ''} aria-label="${title}"></label>`;
}

function numberRow(key: 'unavailableThreshold' | 'pingTimeoutMs', title: string, description: string, min: number, max: number, unit = ''): string {
  return `<label class="setting-row setting-control-row"><span><strong>${title}</strong><small>${description}</small></span><span class="setting-number-wrap"><input class="setting-control setting-number" data-pref="${key}" type="number" min="${min}" max="${max}" step="${key === 'pingTimeoutMs' ? 500 : 1}" value="${uiPreferences[key]}" aria-label="${title}">${unit ? `<small class="setting-unit">${unit}</small>` : ''}</span></label>`;
}

function bindPreferenceInputs(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pref]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.pref as keyof UiPreferences | undefined;
      if (!key) return;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        (uiPreferences as unknown as Record<string, unknown>)[key] = input.checked;
      } else if (input instanceof HTMLInputElement && input.type === 'number') {
        const value = Number(input.value);
        const minimum = Number(input.min);
        const maximum = Number(input.max);
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
          input.value = String(uiPreferences[key]);
          return;
        }
        (uiPreferences as unknown as Record<string, unknown>)[key] = value;
      } else if (key === 'pingUrl') {
        const value = input.value.trim();
        if (!validPingUrl(value)) {
          input.setCustomValidity('Введите домен и необязательный путь, например www.gstatic.com/generate_204');
          input.reportValidity();
          input.value = uiPreferences.pingUrl;
          return;
        }
        input.setCustomValidity('');
        (uiPreferences as unknown as Record<string, unknown>)[key] = value;
      } else {
        (uiPreferences as unknown as Record<string, unknown>)[key] = input.value;
        if (key === 'theme') applyUiTheme();
        if (key === 'journalTimeZone') drawJournal();
      }
      writeUiPreferences(uiPreferences);
      if (key === 'showConnectionSource' && uiPreferences.showConnectionSource && activePage === 'connections' && connections) {
        refreshConnectionSourceNames(connections, mihomoController?.signal ?? new AbortController().signal);
      }
    });
  });
}

async function installAppUpdate(): Promise<void> {
  if (!appRelease || appUpdateInstalling || state.status?.mode !== 'router') return;
  const expectedVersion = state.status.appVersion;
  appUpdateInstalling = true;
  appUpdateMessage = `Загружаем ${appRelease.tag_name} и перезапускаем панель…`;
  updateChrome();
  const messageNode = document.querySelector<HTMLElement>('#app-releases-status');
  const installButton = document.querySelector<HTMLButtonElement>('#app-release-install');
  if (messageNode) messageNode.textContent = appUpdateMessage;
  if (installButton) { installButton.disabled = true; installButton.textContent = 'Устанавливаем…'; }
  render();
  try {
    await requestAppUpdate(appRelease.tag_name);
    // Direct GitHub and both configured proxy fallbacks may each need a
    // connection timeout on constrained router links.
    const deadline = Date.now() + 8 * 60_000;
    let lastDiagnosticCheck = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      try {
        const updated = await getStatus();
        if (updated.appVersion !== expectedVersion && isInstalledReleaseVersion(updated.appVersion, appRelease.tag_name)) {
          appUpdateMessage = `Установлена версия ${updated.appVersion}.`;
          window.location.reload();
          return;
        }
      } catch {
        // The service restarts while the package is replaced; keep polling.
      }
      if (Date.now() - lastDiagnosticCheck >= 3_500) {
        lastDiagnosticCheck = Date.now();
        try {
          const updateLog = await getSystemLog('app-update', AbortSignal.timeout(5000));
          let attemptStart = -1;
          for (let index = updateLog.lines.length - 1; index >= 0; index -= 1) {
            if (updateLog.lines[index]?.includes(`Starting XKeen UI update to ${appRelease.tag_name}`)) {
              attemptStart = index;
              break;
            }
          }
          const attemptLines = attemptStart >= 0 ? updateLog.lines.slice(attemptStart) : [];
          const progress = appUpdateProgressFromLog(updateLog.lines, appRelease.tag_name);
          if (progress && progress !== appUpdateMessage) {
            appUpdateMessage = progress;
            const currentStatus = document.querySelector<HTMLElement>('#app-releases-status');
            if (currentStatus) currentStatus.textContent = progress;
            updateChrome();
          }
          const success = attemptLines.find((line) => line.includes(`SUCCESS: XKeen UI ${appRelease?.tag_name} installed`));
          if (success) {
            appUpdateMessage = `Переустановка ${appRelease.tag_name} завершена.`;
            window.location.reload();
            return;
          }
          let failure: string | undefined;
          for (let index = attemptLines.length - 1; index >= 0; index -= 1) {
            if (attemptLines[index]?.includes('ERROR:')) {
              failure = attemptLines[index];
              break;
            }
          }
          if (failure) throw new Error(`Обновление остановлено: ${failure.replace(/^.*?ERROR:\s*/, '')}`);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Обновление остановлено:')) throw error;
          // The update log is created after the detached updater starts.
        }
      }
    }
    let diagnostic = '';
    try {
      const updateLog = await getSystemLog('app-update', AbortSignal.timeout(5000));
      const details = updateLog.lines.slice(-8).join(' · ');
      if (details) diagnostic = ` Последняя диагностика: ${details}`;
    } catch {
      // The installer may not have created its log yet if startup itself failed.
    }
    throw new Error(`Обновление не подтвердилось за 8 минут.${diagnostic || ' Проверьте системный журнал обновления.'}`);
  } catch (error) {
    appUpdateMessage = error instanceof Error ? error.message : 'Обновление панели завершилось ошибкой.';
  } finally {
    appUpdateInstalling = false;
    updateChrome();
    const message = document.querySelector<HTMLElement>('#app-releases-status');
    if (message) message.textContent = appUpdateMessage;
    if (installButton) {
      installButton.disabled = false;
      installButton.textContent = 'Установить';
    }
    render();
  }
}

async function checkUpdatesInBackground(): Promise<void> {
  if (document.hidden) return;
  if (uiPreferences.autoCheckPanel) {
    try {
      const latest = (await listAppReleases())[0];
      const installed = state.status?.appVersion ?? APP_VERSION;
      if (latest && isNewerVersion(latest.tag_name, installed)) {
        appUpdateAvailable = latest;
        if (!updateNotices.has(`app:${latest.tag_name}`)) {
          updateNotices.add(`app:${latest.tag_name}`);
          appUpdateNoticeDismissed = false;
          updateChrome();
          updateAppUpdateNotice();
        }
      }
    } catch {
      // Background checks stay quiet when a release service is temporarily unavailable.
    }
  }
  if (uiPreferences.autoCheckCore && state.status?.mode === 'router') {
    try {
      const sources = await getCoreSources();
      const [mihomoReleases, xrayReleases] = await Promise.all([
        fetchConfiguredCoreReleases(sources.mihomo),
        fetchConfiguredCoreReleases(sources.xray),
      ]);
      const mihomoLatest = mihomoReleases.find((release) => isStableCompatibleRelease('mihomo', release));
      const xrayLatest = xrayReleases.find((release) => isStableCompatibleRelease('xray', release));
      const installedMihomo = mihomoVersion ?? state.status.services.find((service) => service.name.toLowerCase() === 'mihomo')?.version;
      const installedXray = state.status.services.find((service) => service.name.toLowerCase() === 'xray')?.version;
      for (const [core, latest, installed] of [['Mihomo', mihomoLatest, installedMihomo], ['Xray', xrayLatest, installedXray]] as const) {
        if (latest && installed && isCoreVersionNewer(latest.tag_name, installed) && !updateNotices.has(`${core}:${latest.tag_name}`)) {
          updateNotices.add(`${core}:${latest.tag_name}`);
          showToast(`Доступно обновление ${core} ${latest.tag_name}`, 'info');
        }
      }
    } catch {
      // Do not surface transient GitHub/network errors as panel errors.
    }
  }
}

function isCoreVersionNewer(latest: string, installed: string): boolean {
  const read = (value: string): number[] | null => {
    const match = value.match(/(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:-r(\d+))?/i);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)] : null;
  };
  const left = read(latest);
  const right = read(installed);
  if (!left || !right) return false;
  for (let index = 0; index < 4; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

async function refresh(): Promise<void> {
  requestController?.abort();
  requestController = new AbortController();
  try {
    await getHealth(requestController.signal);
    state.status = await getStatus(requestController.signal);
    xkeenStatus = state.status.mode === 'router' ? await getXkeenStatus(requestController.signal).catch(() => null) : null;
    state.connected = true;
    state.error = null;
    state.checkedAt = new Date();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    state.connected = false;
    state.status = null;
    state.error = error instanceof Error ? error.message : 'Неизвестная ошибка';
  }
  updateChrome();
}

render();
window.addEventListener(CONFIG_APPLY_EVENT, (event) => {
  const detail = (event as CustomEvent<ConfigApplyEventDetail>).detail;
  configApplyBusy = detail.phase === 'start';
  if (detail.phase === 'start') {
    selectedLog = 'xkeen-ui';
    logCleared = false;
    const logSelect = document.querySelector<HTMLSelectElement>('#journal-file');
    if (logSelect) logSelect.value = selectedLog;
    void loadSystemLog();
  } else {
    if (logLoading) logRefreshAfterCurrent = true;
    else void loadSystemLog();
  }
  setJournalRealtime(detail.phase === 'start');
  updateChrome();
  if (detail.phase === 'finish') {
    void refresh();
    if (detail.success && detail.core === 'mihomo') void autoCloseConnectionsAfterApply();
  }
});
// Enhance dialogs and asynchronously rendered settings without replacing native form values.
const selectObserver = new MutationObserver(() => {
  selectObserver.disconnect();
  enhanceStyledSelects();
  syncStyledSelects();
  selectObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
});
enhanceStyledSelects();
selectObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
void refresh();
void loadMihomoPage(activePage);
window.addEventListener('xkeen-core-updated', () => {
  void refresh();
  if (activePage === 'selectors' || activePage === 'connections') void loadMihomoPage(activePage);
});
refreshTimer = window.setInterval(() => void refresh(), 15_000);
autoUpdateTimer = window.setInterval(() => void checkUpdatesInBackground(), 4 * 60 * 60 * 1000);
window.setTimeout(() => void checkUpdatesInBackground(), 20_000);
window.addEventListener('beforeunload', () => {
  requestController?.abort();
  mihomoController?.abort();
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  if (autoUpdateTimer !== undefined) window.clearInterval(autoUpdateTimer);
  logController?.abort();
  if (logRefreshTimer !== undefined) window.clearInterval(logRefreshTimer);
});
let lastLogRefreshAt = 0;
logRefreshTimer = window.setInterval(() => {
  if (document.hidden) return;
  const restartInProgress = xkeenControlBusy || configApplyBusy;
  const now = Date.now();
  if (restartInProgress || now - lastLogRefreshAt >= 5_000) {
    lastLogRefreshAt = now;
    void loadSystemLog();
  }
}, 1_500);
