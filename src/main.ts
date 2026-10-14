import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { ApiError, closeAllMihomoConnections, closeMihomoConnection, controlXkeen, getCoreSources, getHealth, getMihomoConnections, getMihomoSelectors, getMihomoVersion, getStatus, getSystemLog, getXkeenStatus, hasAccessToken, queryMihomoDns, saveCoreSources, selectMihomoProxy, setAccessToken, type ApiState, type CoreSources, type MihomoConnections, type MihomoDnsResult, type MihomoSelector, type ServiceStatus, type SystemLog, type XkeenStatus } from './api';
import { renderConnections, renderSelectors } from './mihomo-view';
import { renderDns } from './dns-view';
import { mountYamlEditor, unmountYamlEditor } from './yaml-editor';
import { bindCoreReleaseChecks } from './core-releases';
import { checkAppUpdate, type AppRelease } from './app-update';

type Page = 'selectors' | 'connections' | 'configuration' | 'dns';

const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'selectors', label: 'Селекторы', icon: '⇄' },
  { id: 'connections', label: 'Соединения', icon: '⌁' },
  { id: 'configuration', label: 'Конфигурация', icon: '⌘' },
  { id: 'dns', label: 'DNS', icon: '◎' },
];

const state: ApiState = { connected: false, status: null, error: null, checkedAt: null };
let activePage: Page = 'selectors';
let refreshTimer: number | undefined;
let requestController: AbortController | undefined;
let mihomoController: AbortController | undefined;
let authRequired = false;
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
let appUpdateMessage = 'Проверка ещё не выполнялась.';
let appUpdateCheckedAt = 0;
let appUpdatePending: Promise<void> | null = null;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Корневой элемент интерфейса #app не найден');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
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
  const coreLabel = mihomoVersion ? `v${escapeHtml(mihomoVersion)}` : service ? (service.version ? `v${escapeHtml(service.version)}` : service.state === 'running' ? 'Активен' : service.state === 'stopped' ? 'Остановлен' : 'Недоступен') : state.connected ? 'Не проверен' : 'Ожидание';
  const serviceText = service ? (service.state === 'running' ? 'Сервис активен' : service.state === 'stopped' ? 'Сервис остановлен' : 'Статус недоступен') : 'Состояние загружается';
  const stamp = state.checkedAt ? state.checkedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
  const memory = status?.memory ? `RAM ${status.memory.usedMb}/${status.memory.totalMb} MB` : 'RAM —';
  const load = status?.loadAverage === null || status?.loadAverage === undefined ? 'Load —' : `Load ${status.loadAverage.toFixed(2)}`;
  const updateLink = appRelease
    ? `<a class="app-update-chip" href="${escapeHtml(appRelease.html_url)}" target="_blank" rel="noopener noreferrer" title="Открыть стабильный релиз XKeen UI">Доступно ${escapeHtml(appRelease.tag_name)} ↗</a>`
    : '';
  return `<header class="topbar">
    <button class="top-status" id="services" type="button" aria-label="Открыть состояние сервисов"><span class="connection-led ${state.connected ? 'is-online' : 'is-offline'}"></span><span><strong>${escapeHtml(serviceText)}</strong><small>${state.connected ? `${memory} · ${load} · API :${status?.port ?? 1001} · ${stamp}` : 'Ожидание соединения с backend'}</small></span></button>
    <a class="brand" href="#selectors" aria-label="XKeen UI, селекторы"><span class="brand-mark">X</span><span>XKeen <b>UI</b></span></a>
    <div class="top-actions"><span class="version-chip core-chip"><span class="chip-icon">◈</span> Mihomo <b>${coreLabel}</b></span><span class="version-chip"><span class="chip-icon">⬡</span> XKeen UI <b>v${status?.appVersion ?? '0.2.2'}</b></span>${updateLink}<button class="icon-button" id="refresh" title="Обновить статус" aria-label="Обновить статус">↻</button><button class="icon-button" id="settings" title="Настройки" aria-label="Настройки">⚙</button></div>
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
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> РАБОЧАЯ ОБЛАСТЬ</div><h1>Конфигурация</h1><p>Изолированные черновики файлов и списков XKeen без доступа к файлам роутера.</p></div><span class="runtime-badge"><span class="runtime-dot"></span> Режим черновика</span></section>
  <section class="editor-workspace" aria-label="Редактор конфигурации Mihomo">
    <div class="config-file-tabs" role="group" aria-label="Файлы конфигурации">${[['config','config'],['ip_exclude','ip_exclude'],['port_exclude','port_exclude'],['port_proxying','port_proxying'],['xkeen','xkeen'],['xray_json','Xray JSON'],['xray_jsonc','Xray routing']].map(([id,label]) => `<button class="config-file-tab" data-config-file="${id}" type="button" aria-pressed="${id === 'config'}">${label}</button>`).join('')}</div>
    <div class="editor-toolbar"><div class="editor-file"><span class="file-mark">⌘</span><div><strong id="editor-filename">config.yaml</strong><small id="editor-file-hint">Локальная вкладка · не файл роутера</small></div><span class="draft-pill">Черновик</span></div><div class="editor-actions"><details class="editor-utilities" data-structured-only><summary class="editor-button">⋯ Утилиты</summary><div class="editor-utilities-menu" role="menu" aria-label="Утилиты конфигурации"><button type="button" role="menuitem" id="yaml-template">▤ Шаблоны конфигураций</button><button type="button" role="menuitem" id="yaml-validate">✓ Проверить</button><button type="button" role="menuitem" id="yaml-format">⌘ Форматировать</button><button type="button" role="menuitem" id="yaml-download">↓ Скачать черновик</button></div></details></div></div>
    <div class="editor-callout"><span class="callout-mark">i</span><p>Черновик хранится только в текущей вкладке браузера. Он не загружается и не применяется на роутере. Проверка проверяет YAML, но не схему конкретной версии Mihomo.</p></div>
    <div class="code-editor-shell"><div class="editor-gutter-label" id="editor-language">YAML · Mihomo</div><div class="code-editor" id="yaml-editor" aria-label="Текст локального черновика конфигурации"></div></div>
    <div class="editor-statusbar"><span id="yaml-validation" class="editor-validation">Черновик пуст</span><span class="editor-encoding">UTF-8 <span>·</span> YAML 1.2 <span>·</span> Mihomo</span></div>
  </section>
  <section class="editor-next-step"><span>◇</span><div><strong>Подключение к конфигурации роутера</strong><p>Чтение и безопасное применение появятся после Rust API с резервной копией, блокировкой пути и подтверждённым откатом.</p></div><span class="coming-tag">НЕ ПОДКЛЮЧЕНО</span></section>`;
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

function renderAccessRequired(): string {
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> ДОСТУП К ПАНЕЛИ</div><h1>Требуется ключ доступа</h1><p>Введите ключ, выданный установщиком XKeen UI.</p></div></section><div class="alert alert-error"><span class="alert-icon">!</span><div><strong>Backend отклонил запрос</strong><p>${escapeHtml(state.error ?? 'Для продолжения нужна авторизация.')}</p></div><button class="text-button" id="authenticate">Ввести ключ</button></div>`;
}

function render(): void {
  if (!app) return;
  if (activePage !== 'configuration' || authRequired) unmountYamlEditor();
  const pageContent = authRequired ? renderAccessRequired()
    : activePage === 'selectors' ? renderSelectors(selectors, selectorsLoading, selectorsError)
      : activePage === 'connections' ? renderConnections(connections, connectionsLoading, connectionsError)
        : activePage === 'dns' ? renderDns(dnsResult, dnsLoading, dnsError, dnsQueryName, dnsQueryType, dnsPanel)
        : renderComingSoon(activePage);
  app.innerHTML = `<div class="app-shell">${renderHeader()}${renderNavigation()}<main class="main-content">${pageContent}</main>${renderJournal()}<div class="toast-region" aria-live="polite"></div></div>`;
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
  document.querySelector<HTMLButtonElement>('#services')?.addEventListener('click', renderServicesDialog);
  document.querySelector<HTMLButtonElement>('#authenticate')?.addEventListener('click', openAccessDialog);
  document.querySelector<HTMLButtonElement>('#check-app-update')?.addEventListener('click', () => void runAppUpdateCheck(true));
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
  if (activePage === 'configuration' && !authRequired) mountYamlEditor();
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

async function runAppUpdateCheck(force = false): Promise<void> {
  if (appUpdatePending) return appUpdatePending;
  if (!force && Date.now() - appUpdateCheckedAt < 6 * 60 * 60 * 1000) return;
  const installedVersion = state.status?.appVersion ?? '0.2.1';
  appUpdateMessage = 'Проверяем стабильные релизы GitHub…';
  const messageNode = document.querySelector<HTMLElement>('#app-update-message');
  const checkButton = document.querySelector<HTMLButtonElement>('#check-app-update');
  if (messageNode) messageNode.textContent = appUpdateMessage;
  if (checkButton) { checkButton.disabled = true; checkButton.textContent = 'Проверяем…'; }
  const pending = (async () => {
    try {
      appRelease = await checkAppUpdate(installedVersion);
      appUpdateMessage = appRelease
        ? `Доступно обновление ${appRelease.tag_name}. Установка из панели пока не подключена.`
        : 'Установлена последняя стабильная версия.';
      appUpdateCheckedAt = Date.now();
    } catch (error) {
      appUpdateMessage = error instanceof Error ? error.message : 'Не удалось проверить обновления.';
      appUpdateCheckedAt = Date.now() - 5 * 60 * 60 * 1000;
    } finally {
      appUpdatePending = null;
      const message = document.querySelector<HTMLElement>('#app-update-message');
      const button = document.querySelector<HTMLButtonElement>('#check-app-update');
      if (message) message.textContent = appUpdateMessage;
      if (button) { button.disabled = false; button.textContent = 'Проверить'; }
      render();
    }
  })();
  appUpdatePending = pending;
  render();
  await pending;
}

function bindMihomoInteractions(): void {
  document.querySelector<HTMLButtonElement>('#mihomo-refresh,#mihomo-retry')?.addEventListener('click', () => void loadMihomoPage(activePage));
  document.querySelectorAll<HTMLButtonElement>('.proxy-select').forEach((button) => {
    button.addEventListener('click', () => void selectProxyFromUi(button));
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
  if (!group || !name || !window.confirm(`Переключить группу «${group}» на узел «${name}»? Новые соединения группы пойдут через выбранный узел.`)) return;
  button.disabled = true;
  button.textContent = 'Переключаем…';
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
  document.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', openSettings);
  document.querySelector<HTMLButtonElement>('#services')?.addEventListener('click', renderServicesDialog);
}

function openAccessDialog(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form method="dialog" class="modal-panel" id="access-form"><div class="modal-heading"><span class="modal-icon">◇</span><h2>Вход в XKeen UI</h2><button class="icon-button" value="cancel" aria-label="Закрыть">×</button></div><p class="access-copy">Ключ хранится только до закрытия вкладки и используется для запросов к локальной панели.</p><label class="access-label" for="access-token">Ключ доступа</label><input class="access-input" id="access-token" type="password" autocomplete="current-password" required autofocus><button class="button button-primary modal-close" value="default">Подключиться</button></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLFormElement>('#access-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = dialog.querySelector<HTMLInputElement>('#access-token')?.value.trim();
    if (!token) return;
    setAccessToken(token);
    dialog.close();
    void refresh();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
}

function openSettings(): void {
  const modal = document.createElement('dialog');
  modal.className = 'modal';
  modal.innerHTML = `<form method="dialog" class="modal-panel"><div class="modal-heading"><span class="modal-icon">⚙</span><h2>Настройки панели</h2><button class="icon-button" aria-label="Закрыть">×</button></div><div class="modal-tabs" role="tablist" aria-label="Разделы настроек"><button class="settings-tab selected" id="settings-general" type="button" role="tab" aria-selected="true">Общие</button><button class="settings-tab" id="settings-sources" type="button" role="tab" aria-selected="false">Источники ядер</button><button class="settings-tab" id="settings-security" type="button" role="tab" aria-selected="false">Безопасность</button></div><div id="settings-content" role="tabpanel"></div><button class="button button-primary modal-close">Готово</button></form>`;
  document.body.append(modal);
  modal.showModal();
  const content = modal.querySelector<HTMLElement>('#settings-content');
  const renderSettingsTab = (tab: 'general' | 'security' | 'sources') => {
    modal.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
      const selected = button.id === `settings-${tab}`;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (!content) return;
    if (tab === 'general') {
      content.innerHTML = `<div class="setting-row"><div><strong>Порт панели</strong><small>Адрес локального Rust API и интерфейса</small></div><span class="setting-value">${state.status?.port ?? 1001}</span></div><div class="setting-row"><div><strong>Backend</strong><small>${state.connected ? 'Соединение установлено' : 'Соединение отсутствует'}</small></div><span class="state-pill ${state.connected ? 'state-running' : 'state-unavailable'}">${state.connected ? 'На связи' : 'Ожидание'}</span></div><div class="setting-row"><div><strong>Режим</strong><small>Источник системных сведений</small></div><span class="setting-value">${state.status?.mode === 'router' ? 'Роутер' : 'Симуляция'}</span></div><div class="setting-row"><div><strong>Версия XKeen UI</strong><small>Установленная сборка</small></div><span class="setting-value">${escapeHtml(state.status?.appVersion ?? '0.2.1')}</span></div><div class="app-update-settings"><div><strong>Обновления панели</strong><small id="app-update-message" aria-live="polite">${escapeHtml(appUpdateMessage)}</small></div><button class="editor-button" id="check-app-update" type="button" ${appUpdatePending ? 'disabled' : ''}>${appUpdatePending ? 'Проверяем…' : 'Проверить'}</button></div>`;
      return;
    }
    if (tab === 'sources') {
      const sourceStorageNote = state.status?.mode === 'router'
        ? 'В режиме роутера значения хранятся в собственном файле настроек XKeen UI.'
        : 'В локальной симуляции значения хранятся в памяти до перезапуска backend.';
      content.innerHTML = `<p class="modal-note">Задайте GitHub-репозитории форков Xray и Mihomo. Здесь хранится адрес источника релизов; установленный путь ядра не меняется. ${sourceStorageNote}</p>
        <label class="source-field"><span><strong>Источник Xray</strong><small>Формат: github.com/владелец/репозиторий</small></span><input id="source-xray" type="url" autocomplete="url" placeholder="https://github.com/XTLS/Xray-core"></label>
        <label class="source-field"><span><strong>Источник Mihomo</strong><small>Поддерживаются совместимые репозитории и форки</small></span><input id="source-mihomo" type="url" autocomplete="url" placeholder="https://github.com/MetaCubeX/mihomo"></label>
        <div class="core-release-checks"><section><div><strong>Xray</strong><small>Проверить последние ARM64-релизы</small></div><button type="button" class="editor-button" data-core-release="xray">Проверить релизы</button></section><div id="releases-xray" aria-live="polite"></div>
        <section><div><strong>Mihomo</strong><small>Проверить последние ARM64-релизы</small></div><button type="button" class="editor-button" data-core-release="mihomo">Проверить релизы</button></section><div id="releases-mihomo" aria-live="polite"></div></div>
        <div class="source-save-row"><span class="sources-feedback" id="sources-feedback" aria-live="polite">Загружаем сохранённые значения…</span><button class="editor-button editor-button-primary" type="button" id="save-core-sources">Сохранить источники</button></div>`;
      bindCoreReleaseChecks();
      const xrayInput = content.querySelector<HTMLInputElement>('#source-xray');
      const mihomoInput = content.querySelector<HTMLInputElement>('#source-mihomo');
      const feedback = content.querySelector<HTMLElement>('#sources-feedback');
      void getCoreSources().then((sources) => {
        if (xrayInput) xrayInput.value = sources.xray;
        if (mihomoInput) mihomoInput.value = sources.mihomo;
        if (feedback) feedback.textContent = 'Сохранённые настройки загружены.';
      }).catch((error: unknown) => {
        if (feedback) feedback.textContent = error instanceof Error ? error.message : 'Не удалось загрузить настройки.';
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
    const tokenPresent = hasAccessToken();
    content.innerHTML = `<div class="setting-row"><div><strong>Ключ API</strong><small>${tokenPresent ? 'Хранится только в sessionStorage этой вкладки' : 'Ключ этой вкладки не сохранён'}</small></div><span class="state-pill ${tokenPresent ? 'state-running' : 'state-unavailable'}">${tokenPresent ? 'Установлен' : 'Не задан'}</span></div><div class="security-actions"><button class="editor-button" id="replace-token">${tokenPresent ? 'Заменить ключ' : 'Добавить ключ'}</button>${tokenPresent ? '<button class="editor-button danger-button" id="forget-token">Забыть ключ</button>' : ''}</div><p class="modal-note">Секрет не отображается и не записывается в localStorage.${tokenPresent ? ' Удаление ключа отключит запросы к защищённому API.' : ''}</p>`;
    modal.querySelector<HTMLButtonElement>('#replace-token')?.addEventListener('click', () => { modal.close(); openAccessDialog(); });
    modal.querySelector<HTMLButtonElement>('#forget-token')?.addEventListener('click', () => { setAccessToken(null); modal.close(); void refresh(); });
  };
  modal.querySelector<HTMLButtonElement>('#settings-general')?.addEventListener('click', () => renderSettingsTab('general'));
  modal.querySelector<HTMLButtonElement>('#settings-sources')?.addEventListener('click', () => renderSettingsTab('sources'));
  modal.querySelector<HTMLButtonElement>('#settings-security')?.addEventListener('click', () => renderSettingsTab('security'));
  renderSettingsTab('general');
  modal.addEventListener('close', () => modal.remove(), { once: true });
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
    authRequired = false;
    state.checkedAt = new Date();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    state.connected = false;
    state.status = null;
    authRequired = error instanceof ApiError && error.status === 401;
    state.error = authRequired ? 'Сервер отклонил ключ доступа' : error instanceof Error ? error.message : 'Неизвестная ошибка';
  }
  if (activePage === 'configuration' && !authRequired) updateChrome();
  else render();
  if (activePage === 'selectors' || activePage === 'connections') void loadMihomoPage(activePage);
  void runAppUpdateCheck();
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
