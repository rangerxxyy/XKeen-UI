import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { closeAllMihomoConnections, closeMihomoConnection, controlXkeen, getCoreSources, getHealth, getMihomoConnections, getMihomoSelectors, getMihomoVersion, getStatus, getSystemLog, getXkeenStatus, pingMihomoGroup, queryMihomoDns, requestAppUpdate, saveCoreSources, selectMihomoProxy, type ApiState, type CoreSources, type MihomoConnections, type MihomoDnsResult, type MihomoSelector, type ServiceStatus, type SystemLog, type XkeenStatus } from './api';
import { applyPingResults, renderConnections, renderSelectors } from './mihomo-view';
import { renderDns } from './dns-view';
import { bindCoreReleaseChecks, openCoreReleaseDialog } from './core-releases';
import { listAppReleases, type AppRelease } from './app-update';

type Page = 'selectors' | 'connections' | 'configuration' | 'dns';

const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'selectors', label: 'Селекторы', icon: '⇄' },
  { id: 'connections', label: 'Соединения', icon: '⌁' },
  { id: 'configuration', label: 'Конфигурация', icon: '⌘' },
  { id: 'dns', label: 'DNS', icon: '◎' },
];

const state: ApiState = { connected: false, status: null, error: null, checkedAt: null };
type YamlEditorModule = typeof import('./yaml-editor');
let yamlEditorModule: YamlEditorModule | null = null;
let yamlEditorLoad: Promise<YamlEditorModule> | null = null;
let activePage: Page = 'selectors';
let refreshTimer: number | undefined;
let requestController: AbortController | undefined;
let mihomoController: AbortController | undefined;
let selectors: MihomoSelector[] = [];
let selectorsLoading = true;
let selectorsError: string | null = null;
let connections: MihomoConnections | null = null;
let connectionsLoading = true;
let connectionsError: string | null = null;
let dnsResult: MihomoDnsResult | null = null;
let dnsLoading = false;
let dnsError: string | null = null;
let dnsQueryName = '';
let dnsQueryType = 'A';
let dnsPanel: 'mihomo' | 'handoff' = 'mihomo';
let dnsController: AbortController | undefined;
let mihomoVersion: string | null = null;
let xkeenStatus: XkeenStatus | null = null;
let xkeenControlMessage = '';
let xkeenControlBusy = false;
const logFiles = [
  { id: 'xray-error', label: 'Xray · error.log' },
  { id: 'xray-access', label: 'Xray · access.log' },
  { id: 'web-error', label: 'Web · error.log' },
  { id: 'nfqws2', label: 'nfqws2.log' },
  { id: 'xkeen-ui', label: 'XKeen UI · xkeen-ui.log' },
  { id: 'app-update', label: 'XKeen UI · update.log' },
];
let selectedLog = 'xray-error';
let logData: SystemLog | null = null;
let logError: string | null = null;
let logLoading = false;
let logCleared = false;
let logExpanded = false;
let logFilter = '';
let logController: AbortController | undefined;
let logRefreshTimer: number | undefined;
let appRelease: AppRelease | null = null;
let appReleases: AppRelease[] = [];
let appUpdateMessage = 'Подготовка обновления…';
let appUpdateInstalling = false;

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

function serviceBadge(service: ServiceStatus): string {
  const label: Record<ServiceStatus['state'], string> = {
    running: 'Активен', stopped: 'Остановлен', unavailable: 'Недоступен', unknown: 'Неизвестно',
  };
  return `<span class="state-pill state-${service.state}"><span class="state-dot"></span>${label[service.state]}</span>`;
}

function renderHeader(): string {
  const status = state.status;
  const service = status?.services.find((item) => item.name.toLowerCase() === 'mihomo');
  const formatVersion = (version: string) => `v${escapeHtml(version.replace(/^v+/i, ''))}`;
  const coreLabel = mihomoVersion ? formatVersion(mihomoVersion) : service ? (service.version ? formatVersion(service.version) : service.state === 'running' ? 'Активен' : service.state === 'stopped' ? 'Остановлен' : 'Недоступен') : state.connected ? 'Не проверен' : 'Ожидание';
  const serviceText = service ? (service.state === 'running' ? 'Сервис активен' : service.state === 'stopped' ? 'Сервис остановлен' : 'Статус недоступен') : 'Состояние загружается';
  const memory = status?.memory ? `RAM ${status.memory.usedMb}/${status.memory.totalMb} MB` : 'RAM —';
  const cpu = status?.cpuPercent === null || status?.cpuPercent === undefined ? 'CPU —' : `CPU ${Math.round(status.cpuPercent)}%`;
  return `<header class="topbar">
    <button class="top-status" id="services" type="button" aria-label="Открыть состояние сервисов"><span class="connection-led ${state.connected ? 'is-online' : 'is-offline'}"></span><span><strong>${escapeHtml(serviceText)}</strong><small>${state.connected ? `${memory} · ${cpu}` : 'Ожидание соединения с backend'}</small></span></button>
    <a class="brand" href="#selectors" aria-label="XKeen UI, селекторы"><span class="brand-mark">X</span><span>XKeen <b>UI</b></span></a>
    <div class="top-actions"><button class="version-chip core-chip core-version-button" id="core-version" type="button" title="Выбрать релиз Mihomo"><span class="chip-icon">◈</span> Mihomo <b>${coreLabel}</b><span class="chip-chevron" aria-hidden="true">⌄</span></button><button class="version-chip app-version-button" id="app-version" type="button" title="Выбрать релиз XKeen UI"><span class="chip-icon">⬡</span> XKeen UI <b>v${status?.appVersion ?? APP_VERSION}</b><span class="chip-chevron" aria-hidden="true">⌄</span></button><button class="icon-button" id="refresh" title="Обновить статус" aria-label="Обновить статус">↻</button><button class="icon-button" id="settings" title="Настройки" aria-label="Настройки">⚙</button></div>
  </header>`;
}

function renderNavigation(): string {
  return `<nav class="navigation" aria-label="Разделы панели">${pages.map((page) => `<button class="nav-item ${activePage === page.id ? 'active' : ''}" data-page="${page.id}" ${activePage === page.id ? 'aria-current="page"' : ''}><span class="nav-icon">${page.icon}</span>${page.label}</button>`).join('')}<span class="nav-spacer"></span><span class="environment-tag"><span class="tiny-dot"></span>${state.status?.mode === 'router' ? 'Роутер' : 'Локальная среда'}</span></nav>`;
}

function renderServiceCard(service: ServiceStatus): string {
  const isXkeen = service.name.toLowerCase() === 'xkeen';
  const effectiveService: ServiceStatus = isXkeen && xkeenStatus
    ? { ...service, state: !xkeenStatus.installed ? 'unavailable' : xkeenStatus.running === null ? 'unknown' : xkeenStatus.running ? 'running' : 'stopped', version: xkeenStatus.version, detail: xkeenStatus.detail }
    : service;
  const icon = service.name === 'Xray' ? '✳' : service.name === 'Mihomo' ? '◉' : '⌂';
  const summary = isXkeen && xkeenStatus?.version ? `Версия ${escapeHtml(xkeenStatus.version)}` : service.version ? `Версия ${escapeHtml(service.version)}` : escapeHtml(effectiveService.detail);
  const canControl = isXkeen && state.status?.mode === 'router' && xkeenStatus?.installed;
  const actions = canControl
    ? `<div class="service-controls" aria-label="Управление XKeen"><button class="editor-button" data-xkeen-action="start" ${xkeenControlBusy || xkeenStatus?.running ? 'disabled' : ''}>Запустить</button><button class="editor-button" data-xkeen-action="restart" ${xkeenControlBusy ? 'disabled' : ''}>Перезапустить</button><button class="editor-button danger-button" data-xkeen-action="stop" ${xkeenControlBusy || xkeenStatus?.running === false ? 'disabled' : ''}>Остановить</button></div>${xkeenStatus?.initPath ? `<small class="service-path">Init: ${escapeHtml(xkeenStatus.initPath)} · ${escapeHtml(xkeenStatus.core ?? 'ядро не определено')}</small>` : ''}${xkeenControlMessage ? `<p class="xkeen-control-message" role="status">${escapeHtml(xkeenControlMessage)}</p>` : ''}`
    : '';
  return `<article class="service-card"><div class="service-heading"><span class="service-icon">${icon}</span><div class="service-name"><strong>${escapeHtml(service.name)}</strong><small>${summary}</small></div>${serviceBadge(effectiveService)}</div><div class="service-foot"><span>${effectiveService.state === 'running' ? 'Работает' : effectiveService.state === 'unavailable' ? 'Проверка недоступна' : effectiveService.state === 'stopped' ? 'Остановлен' : 'Нет подтверждения запуска'}</span>${isXkeen && xkeenStatus?.detail ? `<span>${escapeHtml(xkeenStatus.detail)}</span>` : ''}</div>${actions}</article>`;
}

function emptyCard(title: string, body: string): string {
  return `<div class="empty-card"><span class="empty-icon">◌</span><strong>${title}</strong><p>${body}</p></div>`;
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
  const router = state.status?.mode === 'router';
  return `<section class="page-heading"><h1>Конфигурация</h1><span class="runtime-badge"><span class="runtime-dot"></span> ${router ? 'Роутер' : 'Черновик'}</span></section>
  <section class="editor-workspace" aria-label="Редактор конфигурации Mihomo">
    <div class="config-file-tabs" role="group" aria-label="Файлы конфигурации">${[['config','config'],['ip_exclude','ip_exclude'],['port_exclude','port_exclude'],['port_proxying','port_proxying'],['xkeen','xkeen'],['xray_json','Xray JSON'],['xray_jsonc','Xray routing']].map(([id,label]) => `<button class="config-file-tab" data-config-file="${id}" type="button" aria-pressed="${id === 'config'}">${label}</button>`).join('')}</div>
    <div class="editor-toolbar"><div class="editor-file"><span class="file-mark">⌘</span><div><strong id="editor-filename">config.yaml</strong><small id="editor-file-hint">Локальная вкладка · не файл роутера</small></div><span class="draft-pill">Черновик</span></div><div class="editor-actions"><button class="editor-button" id="config-load-active" type="button" data-yaml-only title="Прочитать /opt/etc/mihomo/config.yaml">↓ Считать конфиг</button><button class="editor-button editor-button-primary" id="config-apply-active" type="button" data-yaml-only disabled title="Сначала считайте актуальный конфиг роутера">Применить на роутер</button><details class="editor-utilities" data-structured-only><summary class="editor-button">⋯ Утилиты</summary><div class="editor-utilities-menu" role="menu" aria-label="Утилиты конфигурации"><button type="button" role="menuitem" id="yaml-template">▤ Шаблоны конфигураций</button><button type="button" role="menuitem" id="yaml-validate">✓ Проверить</button><button type="button" role="menuitem" id="yaml-format">⌘ Форматировать</button><button type="button" role="menuitem" id="yaml-download">↓ Скачать черновик</button></div></details></div></div>
    <div class="editor-callout"><span class="callout-mark">i</span><p>Перед применением конфиг проверяется, предыдущая версия сохраняется в резервную копию.</p></div>
    <div class="code-editor-shell"><div class="editor-gutter-label" id="editor-language">YAML · Mihomo</div><div class="code-editor" id="yaml-editor" aria-label="Текст локального черновика конфигурации"></div></div>
    <div class="editor-statusbar"><span id="yaml-validation" class="editor-validation">Черновик пуст</span><span class="editor-encoding">UTF-8 <span>·</span> YAML 1.2 <span>·</span> Mihomo</span></div>
  </section>
  ${router ? '' : '<section class="editor-next-step"><span>◇</span><div><strong>Режим предпросмотра</strong><p>Из этого окружения доступно только редактирование черновиков. Для чтения и применения конфига откройте панель на роутере.</p></div><span class="coming-tag">ЛОКАЛЬНЫЙ РЕЖИМ</span></section>'}`;
}

function renderFooter(): string {
  return `<footer class="footer"><span><span class="footer-mark">✳</span> XKeen UI <span class="footer-muted">· первая версия</span></span><span>${state.connected ? 'Backend отвечает' : 'Backend не подключён'} <span class="footer-indicator ${state.connected ? 'is-online' : ''}"></span></span></footer>`;
}

function renderJournal(): string {
  return `<section class="journal-panel ${logExpanded ? 'is-expanded' : ''}" aria-label="Журнал событий"><header class="journal-heading"><h2>Журнал</h2><div class="journal-tools"><label class="journal-filter"><span aria-hidden="true">⌕</span><input id="journal-filter" type="search" placeholder="Фильтр" aria-label="Фильтр журнала" value="${escapeHtml(logFilter)}"></label><select id="journal-file" aria-label="Файл журнала">${logFiles.map((file) => `<option value="${file.id}" ${selectedLog === file.id ? 'selected' : ''}>${file.label}</option>`).join('')}</select><button class="journal-icon-button" id="journal-clear" type="button" title="Очистить отображение" aria-label="Очистить отображение">♲</button><button class="journal-icon-button" id="journal-expand" type="button" title="Развернуть журнал" aria-label="Развернуть журнал" aria-pressed="${logExpanded}">${logExpanded ? '⤢' : '⛶'}</button></div></header><div class="journal-body" id="journal-body" aria-live="polite"></div></section>`;
}

function drawJournal(): void {
  const body = document.querySelector<HTMLElement>('#journal-body');
  if (!body) return;
  if (logLoading) {
    body.innerHTML = '<div class="journal-empty"><span class="loading-orbit" aria-hidden="true"></span><strong>Загружаем журнал</strong></div>';
    return;
  }
  if (logError) {
    body.innerHTML = `<div class="journal-empty"><span class="journal-empty-icon">!</span><strong>Журнал недоступен</strong><p>${escapeHtml(logError)}</p></div>`;
    return;
  }
  if (logCleared) {
    body.innerHTML = '<div class="journal-empty"><span class="journal-empty-icon">✓</span><strong>Отображение очищено</strong><p>Исходный файл на устройстве не изменён.</p></div>';
    return;
  }
  const filter = logFilter.trim().toLocaleLowerCase();
  const lines = (logData?.lines ?? []).filter((line) => !filter || line.toLocaleLowerCase().includes(filter));
  const list = document.createElement('div');
  list.className = 'journal-lines';
  for (const [index, line] of lines.entries()) {
    const row = document.createElement('div');
    row.className = 'journal-line';
    row.dataset.level = /\b(error|fatal|panic)\b/i.test(line) ? 'error' : /\b(warn|warning)\b/i.test(line) ? 'warning' : 'info';
    const number = document.createElement('span');
    number.className = 'journal-line-number';
    number.textContent = String(index + 1).padStart(3, '0');
    const message = document.createElement('code');
    message.textContent = line;
    row.append(number, message);
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
  } else body.append(list);
}

async function loadSystemLog(): Promise<void> {
  if (logLoading) return;
  logController?.abort();
  const controller = new AbortController();
  logController = controller;
  logLoading = true;
  logError = null;
  logCleared = false;
  drawJournal();
  try {
    logData = await getSystemLog(selectedLog, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    logData = null;
    logError = error instanceof Error ? error.message : 'Не удалось загрузить журнал';
  } finally {
    if (logController === controller) {
      logLoading = false;
      drawJournal();
    }
  }
}

function bindJournal(): void {
  const fileSelect = document.querySelector<HTMLSelectElement>('#journal-file');
  fileSelect?.addEventListener('change', () => {
    selectedLog = fileSelect.value;
    logController?.abort();
    logLoading = false;
    logData = null;
    void loadSystemLog();
  });
  document.querySelector<HTMLInputElement>('#journal-filter')?.addEventListener('input', (event) => {
    logFilter = (event.currentTarget as HTMLInputElement).value;
    drawJournal();
  });
  document.querySelector<HTMLButtonElement>('#journal-clear')?.addEventListener('click', () => {
    logCleared = true;
    drawJournal();
  });
  document.querySelector<HTMLButtonElement>('#journal-expand')?.addEventListener('click', () => {
    logExpanded = !logExpanded;
    document.querySelector('.journal-panel')?.classList.toggle('is-expanded', logExpanded);
    const button = document.querySelector<HTMLButtonElement>('#journal-expand');
    if (button) {
      button.textContent = logExpanded ? '⤢' : '⛶';
      button.setAttribute('aria-pressed', String(logExpanded));
      button.title = logExpanded ? 'Свернуть журнал' : 'Развернуть журнал';
    }
  });
  drawJournal();
  if (!logData && !logError && !logLoading) void loadSystemLog();
}

function renderServicesDialog(): void {
  let dialog = document.querySelector<HTMLDialogElement>('#services-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'services-dialog';
    dialog.className = 'modal';
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog?.remove(), { once: true });
  }
  const services = state.status?.services ?? [];
  dialog.innerHTML = `<div class="modal-panel services-modal"><div class="modal-heading"><span class="modal-icon">◈</span><h2>Состояние сервисов</h2><button class="icon-button" id="services-close" type="button" aria-label="Закрыть">×</button></div><div class="service-grid">${services.length ? services.map(renderServiceCard).join('') : emptyCard('Состояние недоступно', 'Подключите backend, чтобы увидеть сервисы.')}</div><p class="service-dialog-note">Управление XKeen применяет команды к системной службе роутера.</p></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('#services-close')?.addEventListener('click', () => dialog?.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-xkeen-action]').forEach((button) => button.addEventListener('click', () => void runXkeenAction(button.dataset.xkeenAction)));
}

async function mountConfigurationEditor(): Promise<void> {
  try {
    yamlEditorLoad ??= import('./yaml-editor');
    yamlEditorModule = await yamlEditorLoad;
    if (activePage === 'configuration') yamlEditorModule.mountYamlEditor();
  } catch (error) {
    yamlEditorLoad = null;
    const status = document.querySelector<HTMLElement>('#yaml-validation');
    if (status) status.textContent = error instanceof Error ? `Не удалось загрузить редактор: ${error.message}` : 'Не удалось загрузить редактор конфигурации.';
  }
}

function render(): void {
  if (!app) return;
  const scrollTop = app.querySelector<HTMLElement>('.workspace-scroll')?.scrollTop ?? 0;
  if (activePage !== 'configuration') yamlEditorModule?.unmountYamlEditor();
  const pageContent = activePage === 'selectors' ? renderSelectors(selectors, selectorsLoading, selectorsError)
      : activePage === 'connections' ? renderConnections(connections, connectionsLoading, connectionsError)
        : activePage === 'dns' ? renderDns(dnsResult, dnsLoading, dnsError, dnsQueryName, dnsQueryType, dnsPanel)
        : renderComingSoon(activePage);
  app.innerHTML = `<div class="app-shell">${renderHeader()}${renderNavigation()}<div class="workspace-scroll"><main class="main-content">${pageContent}</main>${renderJournal()}</div><div class="toast-region" aria-live="polite"></div></div>`;
  app.querySelector<HTMLElement>('.workspace-scroll')!.scrollTop = scrollTop;
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
        render();
        void loadMihomoPage(page);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('#refresh,#refresh-secondary,#retry').forEach((button) => button.addEventListener('click', () => void refresh()));
  document.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', openSettings);
  document.querySelector<HTMLButtonElement>('#app-version')?.addEventListener('click', () => void openAppReleases());
  document.querySelector<HTMLButtonElement>('#core-version')?.addEventListener('click', () => void openCoreReleaseDialog(
    'mihomo', async () => (await getCoreSources()).mihomo, mihomoVersion,
  ));
  document.querySelector<HTMLButtonElement>('#services')?.addEventListener('click', renderServicesDialog);
  document.querySelectorAll<HTMLButtonElement>('[data-xkeen-action]').forEach((button) => {
    button.addEventListener('click', () => void runXkeenAction(button.dataset.xkeenAction));
  });
  document.querySelector<HTMLFormElement>('#dns-query-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    dnsQueryName = String(data.get('name') ?? '').trim();
    dnsQueryType = String(data.get('type') ?? 'A');
    void runDnsQuery();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dns-panel]').forEach((button) => button.addEventListener('click', () => {
    const panel = button.dataset.dnsPanel;
    if (panel === 'mihomo' || panel === 'handoff') {
      dnsPanel = panel;
      render();
    }
  }));
  if (activePage === 'configuration') void mountConfigurationEditor();
  bindMihomoInteractions();
}

async function runXkeenAction(action: string | undefined): Promise<void> {
  if (action !== 'start' && action !== 'stop' && action !== 'restart') return;
  const prompt = action === 'start'
    ? 'Запустить XKeen? Это активирует проксирование согласно текущей конфигурации роутера.'
    : action === 'stop'
      ? 'Остановить XKeen? Трафик роутера перестанет идти через прокси.'
      : 'Перезапустить XKeen? Активные соединения могут прерваться.';
  if (!window.confirm(prompt)) return;
  xkeenControlBusy = true;
  xkeenControlMessage = `Выполняется команда ${action}…`;
  render();
  try {
    xkeenStatus = await controlXkeen(action);
    xkeenControlMessage = `Команда ${action} завершена.`;
  } catch (error) {
    xkeenControlMessage = error instanceof Error ? error.message : 'Не удалось выполнить команду XKeen';
  } finally {
    xkeenControlBusy = false;
    render();
    if (document.querySelector('#services-dialog')) renderServicesDialog();
  }
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
  } finally {
    if (!controller.signal.aborted) {
      dnsLoading = false;
      if (activePage === 'dns') render();
    }
  }
}

function bindMihomoInteractions(): void {
  document.querySelector<HTMLButtonElement>('#mihomo-retry')?.addEventListener('click', () => void loadMihomoPage(activePage));
  document.querySelectorAll<HTMLButtonElement>('.proxy-option').forEach((button) => {
    button.addEventListener('click', () => void selectProxyFromUi(button));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-ping-group]').forEach((button) => {
    button.addEventListener('click', () => void pingGroupFromUi(button));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-close-connection]').forEach((button) => {
    button.addEventListener('click', () => void closeConnectionFromUi(button));
  });
  document.querySelector<HTMLButtonElement>('#close-all-connections')?.addEventListener('click', () => void closeAllConnectionsFromUi());
  document.querySelector<HTMLInputElement>('#connection-filter')?.addEventListener('input', (event) => {
    const query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll<HTMLTableRowElement>('.connection-table tbody tr').forEach((row) => {
      const matches = row.dataset.search?.includes(query) ?? false;
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const noResults = document.querySelector<HTMLElement>('.connection-no-results.is-filtered');
    if (noResults) noResults.hidden = query.length === 0 || visible > 0;
  });
}

async function pingGroupFromUi(button: HTMLButtonElement): Promise<void> {
  const group = button.dataset.pingGroup;
  if (!group || button.disabled) return;
  button.disabled = true;
  button.textContent = '…';
  try {
    const results = await pingMihomoGroup(group, mihomoController?.signal);
    selectors = applyPingResults(selectors, results);
    render();
  } catch (error) {
    button.title = error instanceof Error ? error.message : 'Не удалось проверить серверы';
  } finally {
    button.disabled = false;
    button.textContent = 'ϟ';
  }
}

async function closeConnectionFromUi(button: HTMLButtonElement): Promise<void> {
  const id = button.dataset.closeConnection;
  if (!id || !window.confirm('Закрыть выбранное соединение? Текущий сетевой запрос может прерваться.')) return;
  button.disabled = true;
  try {
    await closeMihomoConnection(id, mihomoController?.signal);
    await loadMihomoPage('connections');
  } catch (error) {
    connectionsError = error instanceof Error ? error.message : 'Не удалось закрыть соединение';
    connectionsLoading = false;
    render();
  }
}

async function closeAllConnectionsFromUi(): Promise<void> {
  const count = connections?.connections.length ?? 0;
  if (!count || !window.confirm(`Закрыть все ${count} активных соединений? Это может прервать текущие запросы устройств.`)) return;
  const button = document.querySelector<HTMLButtonElement>('#close-all-connections');
  if (button) { button.disabled = true; button.textContent = 'Закрываем…'; }
  try {
    await closeAllMihomoConnections(mihomoController?.signal);
    await loadMihomoPage('connections');
  } catch (error) {
    connectionsError = error instanceof Error ? error.message : 'Не удалось закрыть соединения';
    connectionsLoading = false;
    render();
  }
}

async function loadMihomoPage(page: Page): Promise<void> {
  if (page !== 'selectors' && page !== 'connections') return;
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
  if (page === 'selectors') { selectorsLoading = true; selectorsError = null; }
  else { connectionsLoading = true; connectionsError = null; }
  if (activePage === page) render();
  try {
    if (page === 'selectors') selectors = await getMihomoSelectors(signal);
    else connections = await getMihomoConnections(signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка API Mihomo';
    if (page === 'selectors') selectorsError = message;
    else connectionsError = message;
  } finally {
    if (!signal.aborted) {
      if (page === 'selectors') selectorsLoading = false;
      else connectionsLoading = false;
      if (activePage === page) render();
    }
  }
}

async function selectProxyFromUi(button: HTMLButtonElement): Promise<void> {
  const group = button.dataset.proxyGroup;
  const name = button.dataset.proxyName;
  if (button.getAttribute('aria-current') === 'true') return;
  if (!group || !name || !window.confirm(`Переключить группу «${group}» на узел «${name}»? Новые соединения группы пойдут через выбранный узел.`)) return;
  button.disabled = true;
  button.disabled = true;
  try {
    await selectMihomoProxy(group, name, mihomoController?.signal);
    await loadMihomoPage('selectors');
  } catch (error) {
    selectorsError = error instanceof Error ? error.message : 'Не удалось выбрать узел';
    selectorsLoading = false;
    render();
  }
}

function updateChrome(): void {
  const currentHeader = document.querySelector('.topbar');
  const currentFooter = document.querySelector('.footer');
  if (currentHeader) {
    const container = document.createElement('div');
    container.innerHTML = renderHeader();
    currentHeader.replaceWith(container.firstElementChild!);
  }
  if (currentFooter) {
    const container = document.createElement('div');
    container.innerHTML = renderFooter();
    currentFooter.replaceWith(container.firstElementChild!);
  }
  document.querySelector<HTMLButtonElement>('#refresh')?.addEventListener('click', () => void refresh());
  document.querySelector<HTMLButtonElement>('#app-version')?.addEventListener('click', () => void openAppReleases());
  document.querySelector<HTMLButtonElement>('#core-version')?.addEventListener('click', () => void openCoreReleaseDialog(
    'mihomo', async () => (await getCoreSources()).mihomo, mihomoVersion,
  ));
  document.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', openSettings);
  document.querySelector<HTMLButtonElement>('#services')?.addEventListener('click', renderServicesDialog);
}

async function openAppReleases(): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form method="dialog" class="modal-panel app-releases-panel"><div class="modal-heading"><span class="modal-icon">⬡</span><h2>Обновление XKeen UI</h2><button class="icon-button" aria-label="Закрыть">×</button></div><div class="core-release-dialog-source"><span>zxc-rv/XKeen-UI</span><span class="core-release-github">GitHub</span></div><p class="modal-note" id="app-releases-status" aria-live="polite">Загружаем последние стабильные сборки…</p><div id="app-release-list" class="app-release-list" aria-label="Стабильные релизы XKeen UI"></div><div class="app-release-actions"><a id="app-release-link" class="editor-button" target="_blank" rel="noopener noreferrer" hidden>Открыть релиз ↗</a><button id="app-release-install" class="editor-button editor-button-primary" type="button" disabled>Установить</button></div><button class="button button-primary modal-close">Закрыть</button></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  const status = dialog.querySelector<HTMLElement>('#app-releases-status')!;
  const list = dialog.querySelector<HTMLElement>('#app-release-list')!;
  const link = dialog.querySelector<HTMLAnchorElement>('#app-release-link')!;
  const install = dialog.querySelector<HTMLButtonElement>('#app-release-install')!;
  const choose = () => {
    appRelease = appReleases.find((release) => release.tag_name === list.querySelector<HTMLElement>('.app-release-card.is-selected')?.dataset.releaseTag) ?? null;
    const installed = state.status?.appVersion ?? APP_VERSION;
    const downgrade = appRelease ? isInstalledNewerOrEqual(installed, appRelease.tag_name) && !isInstalledNewerOrEqual(appRelease.tag_name, installed) : false;
    link.href = appRelease?.html_url ?? '#';
    link.hidden = !appRelease;
    install.disabled = !appRelease || state.status?.mode !== 'router' || appUpdateInstalling || downgrade;
    install.textContent = downgrade ? 'Выбрана версия старее установленной'
      : appRelease && !isInstalledNewerOrEqual(installed, appRelease.tag_name) ? 'Установить' : 'Переустановить';
  };
  list.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>('.app-release-card');
    if (!card) return;
    list.querySelectorAll('.app-release-card').forEach((item) => item.classList.toggle('is-selected', item === card));
    list.querySelectorAll('.app-release-card').forEach((item) => item.setAttribute('aria-pressed', String(item === card)));
    choose();
  });
  install.addEventListener('click', () => {
    if (appRelease && window.confirm(`Установить XKeen UI ${appRelease.tag_name}? Панель перезапустится.`)) {
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
  modal.className = 'modal';
  modal.innerHTML = `<form method="dialog" class="modal-panel"><div class="modal-heading"><span class="modal-icon">⚙</span><h2>Настройки панели</h2><button class="icon-button" aria-label="Закрыть">×</button></div><div class="modal-tabs" role="tablist" aria-label="Разделы настроек"><button class="settings-tab selected" id="settings-general" type="button" role="tab" aria-selected="true">Общие</button><button class="settings-tab" id="settings-sources" type="button" role="tab" aria-selected="false">Источники ядер</button></div><div id="settings-content" role="tabpanel"></div><button class="button button-primary modal-close">Готово</button></form>`;
  document.body.append(modal);
  modal.showModal();
  const content = modal.querySelector<HTMLElement>('#settings-content');
  const renderSettingsTab = (tab: 'general' | 'sources') => {
    modal.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
      const selected = button.id === `settings-${tab}`;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (!content) return;
    if (tab === 'general') {
      content.innerHTML = `<div class="setting-row"><div><strong>Порт панели</strong><small>Адрес локального Rust API и интерфейса</small></div><span class="setting-value">${state.status?.port ?? 1001}</span></div><div class="setting-row"><div><strong>Backend</strong><small>${state.connected ? 'Соединение установлено' : 'Соединение отсутствует'}</small></div><span class="state-pill ${state.connected ? 'state-running' : 'state-unavailable'}">${state.connected ? 'На связи' : 'Ожидание'}</span></div><div class="setting-row"><div><strong>Режим</strong><small>Источник системных сведений</small></div><span class="setting-value">${state.status?.mode === 'router' ? 'Роутер' : 'Симуляция'}</span></div><div class="setting-row"><div><strong>Версия XKeen UI</strong><small>Релизы доступны по нажатию версии в верхней панели</small></div><span class="setting-value">${escapeHtml(state.status?.appVersion ?? APP_VERSION)}</span></div>`;
      return;
    }
    if (tab === 'sources') {
      const sourceStorageNote = state.status?.mode === 'router'
        ? 'В режиме роутера значения хранятся в собственном файле настроек XKeen UI.'
        : 'В локальной симуляции значения хранятся в памяти до перезапуска backend.';
      content.innerHTML = `<p class="modal-note">Задайте GitHub-репозитории форков Xray и Mihomo. Здесь хранится адрес источника релизов; установленный путь ядра не меняется. ${sourceStorageNote}</p>
        <label class="source-field"><span><strong>Источник Xray</strong><small>Формат: github.com/владелец/репозиторий</small></span><input id="source-xray" type="url" autocomplete="url" placeholder="https://github.com/XTLS/Xray-core"></label>
        <label class="source-field"><span><strong>Источник релизов Mihomo</strong><small>Можно указать репозиторий установленного форка или другой GitHub-репозиторий</small></span><select id="source-mihomo-preset"><option value="official">Оригинальный Mihomo · MetaCubeX</option><option value="prizrak">Prizrak-Core</option><option value="custom">Другой форк</option></select></label>
        <label class="source-field"><span><strong>Репозиторий</strong><small>Проверка релизов использует это значение; сохранение не заменяет установленное ядро</small></span><input id="source-mihomo" type="url" autocomplete="url" placeholder="https://github.com/MetaCubeX/mihomo"></label>
        <div class="core-release-checks"><section><div><strong>Xray</strong><small>Проверить последние ARM64-релизы</small></div><button type="button" class="editor-button" data-core-release="xray">Проверить релизы</button></section><div id="releases-xray" aria-live="polite"></div>
        <section><div><strong>Mihomo</strong><small>Проверить последние ARM64-релизы</small></div><button type="button" class="editor-button" data-core-release="mihomo">Проверить релизы</button></section><div id="releases-mihomo" aria-live="polite"></div></div>
        <div class="source-save-row"><span class="sources-feedback" id="sources-feedback" aria-live="polite">Загружаем сохранённые значения…</span><button class="editor-button editor-button-primary" type="button" id="save-core-sources">Сохранить источники</button></div>`;
      bindCoreReleaseChecks();
      const xrayInput = content.querySelector<HTMLInputElement>('#source-xray');
      const mihomoInput = content.querySelector<HTMLInputElement>('#source-mihomo');
      const mihomoPreset = content.querySelector<HTMLSelectElement>('#source-mihomo-preset');
      const feedback = content.querySelector<HTMLElement>('#sources-feedback');
      void getCoreSources().then((sources) => {
        if (xrayInput) xrayInput.value = sources.xray;
        if (mihomoInput) mihomoInput.value = sources.mihomo;
        if (mihomoPreset) mihomoPreset.value = sources.mihomo === 'https://github.com/MetaCubeX/mihomo'
          ? 'official' : sources.mihomo === 'https://github.com/legiz-ru/Prizrak-Core' ? 'prizrak' : 'custom';
        if (feedback) feedback.textContent = 'Сохранённые настройки загружены.';
      }).catch((error: unknown) => {
        if (feedback) feedback.textContent = error instanceof Error ? error.message : 'Не удалось загрузить настройки.';
      });
      mihomoPreset?.addEventListener('change', () => {
        if (mihomoPreset.value === 'official' && mihomoInput) mihomoInput.value = 'https://github.com/MetaCubeX/mihomo';
        if (mihomoPreset.value === 'prizrak' && mihomoInput) mihomoInput.value = 'https://github.com/legiz-ru/Prizrak-Core';
      });
      mihomoInput?.addEventListener('input', () => {
        if (mihomoPreset && !['https://github.com/MetaCubeX/mihomo', 'https://github.com/legiz-ru/Prizrak-Core'].includes(mihomoInput.value.trim().replace(/\/$/, ''))) mihomoPreset.value = 'custom';
      });
      content.querySelector<HTMLButtonElement>('#save-core-sources')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        if (!xrayInput || !mihomoInput || !feedback) return;
        button.disabled = true;
        feedback.textContent = 'Сохраняем…';
        try {
          const saved: CoreSources = await saveCoreSources({ xray: xrayInput.value, mihomo: mihomoInput.value });
          xrayInput.value = saved.xray;
          mihomoInput.value = saved.mihomo;
          feedback.textContent = 'Источники ядер сохранены.';
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : 'Не удалось сохранить настройки.';
        } finally {
          button.disabled = false;
        }
      });
      return;
    }

  };
  modal.querySelector<HTMLButtonElement>('#settings-general')?.addEventListener('click', () => renderSettingsTab('general'));
  modal.querySelector<HTMLButtonElement>('#settings-sources')?.addEventListener('click', () => renderSettingsTab('sources'));
  renderSettingsTab('general');
  modal.addEventListener('close', () => modal.remove(), { once: true });
}

async function installAppUpdate(): Promise<void> {
  if (!appRelease || appUpdateInstalling || state.status?.mode !== 'router') return;
  const expectedVersion = state.status.appVersion;
  appUpdateInstalling = true;
  appUpdateMessage = `Загружаем ${appRelease.tag_name} и перезапускаем панель…`;
  const messageNode = document.querySelector<HTMLElement>('#app-releases-status');
  const installButton = document.querySelector<HTMLButtonElement>('#app-release-install');
  if (messageNode) messageNode.textContent = appUpdateMessage;
  if (installButton) { installButton.disabled = true; installButton.textContent = 'Устанавливаем…'; }
  render();
  try {
    await requestAppUpdate(appRelease.tag_name);
    const deadline = Date.now() + 120_000;
    let lastDiagnosticCheck = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      try {
        const updated = await getStatus();
        if (updated.appVersion !== expectedVersion) {
          appUpdateMessage = `Установлена версия ${updated.appVersion}.`;
          window.location.reload();
          return;
        }
      } catch {
        // The service restarts while the package is replaced; keep polling.
      }
      if (Date.now() - lastDiagnosticCheck >= 10_000) {
        lastDiagnosticCheck = Date.now();
        try {
          const updateLog = await getSystemLog('app-update', AbortSignal.timeout(5000));
          const entries = [...updateLog.lines].reverse();
          const success = entries.find((line) => line.includes(`SUCCESS: XKeen UI ${appRelease?.tag_name} installed`));
          if (success && appRelease?.tag_name === `v${expectedVersion.replace(/^v/i, '')}`) {
            appUpdateMessage = `Переустановка ${appRelease.tag_name} завершена.`;
            window.location.reload();
            return;
          }
          const failure = entries.find((line) => line.includes('ERROR:'));
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
    throw new Error(`Обновление не подтвердилось за 2 минуты.${diagnostic || ' Откройте журнал «XKeen UI · update.log» для причины.'}`);
  } catch (error) {
    appUpdateMessage = error instanceof Error ? error.message : 'Обновление панели завершилось ошибкой.';
  } finally {
    appUpdateInstalling = false;
    const message = document.querySelector<HTMLElement>('#app-releases-status');
    if (message) message.textContent = appUpdateMessage;
    if (installButton) {
      installButton.disabled = false;
      installButton.textContent = appRelease && !isInstalledNewerOrEqual(state.status?.appVersion ?? APP_VERSION, appRelease.tag_name)
        ? 'Установить выбранную' : 'Переустановить выбранную';
    }
    render();
  }
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
  if (activePage === 'configuration') updateChrome();
  else render();
  if (activePage === 'selectors' || activePage === 'connections') void loadMihomoPage(activePage);
}

render();
void refresh();
window.addEventListener('xkeen-core-updated', () => void refresh());
refreshTimer = window.setInterval(() => void refresh(), 15_000);
window.addEventListener('beforeunload', () => {
  requestController?.abort();
  mihomoController?.abort();
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  logController?.abort();
  if (logRefreshTimer !== undefined) window.clearInterval(logRefreshTimer);
});
logRefreshTimer = window.setInterval(() => { if (!document.hidden && !logExpanded) void loadSystemLog(); }, 15_000);
