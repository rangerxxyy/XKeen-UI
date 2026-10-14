import './style.css';
import { ApiError, closeAllMihomoConnections, closeMihomoConnection, getHealth, getMihomoConnections, getMihomoSelectors, getMihomoVersion, getStatus, hasAccessToken, queryMihomoDns, selectMihomoProxy, setAccessToken, type ApiState, type MihomoConnections, type MihomoDnsResult, type MihomoSelector, type ServiceStatus } from './api';
import { renderConnections, renderSelectors } from './mihomo-view';
import { renderDns } from './dns-view';
import { mountYamlEditor, unmountYamlEditor } from './yaml-editor';

type Page = 'overview' | 'selectors' | 'connections' | 'dns' | 'configuration' | 'logs';

const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Обзор', icon: '◫' },
  { id: 'selectors', label: 'Селекторы', icon: '⇄' },
  { id: 'connections', label: 'Соединения', icon: '⌁' },
  { id: 'dns', label: 'DNS', icon: '◎' },
  { id: 'configuration', label: 'Конфигурация', icon: '⌘' },
  { id: 'logs', label: 'Журнал', icon: '≋' },
];

const state: ApiState = { connected: false, status: null, error: null, checkedAt: null };
let activePage: Page = 'overview';
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
let dnsController: AbortController | undefined;
let mihomoVersion: string | null = null;

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
  return `<header class="topbar">
    <div class="top-status"><span class="connection-led ${state.connected ? 'is-online' : 'is-offline'}"></span><div><strong>${escapeHtml(serviceText)}</strong><small>${state.connected ? `${memory} · ${load} · API :${status?.port ?? 1001} · ${stamp}` : 'Ожидание соединения с backend'}</small></div></div>
    <a class="brand" href="#overview" aria-label="XKeen UI, главная"><span class="brand-mark">X</span><span>XKeen <b>UI</b></span></a>
    <div class="top-actions"><span class="version-chip core-chip"><span class="chip-icon">◈</span> Mihomo <b>${coreLabel}</b></span><span class="version-chip"><span class="chip-icon">⬡</span> XKeen UI <b>v${status?.appVersion ?? '0.1.0'}</b></span><button class="icon-button" id="refresh" title="Обновить статус" aria-label="Обновить статус">↻</button><button class="icon-button" id="settings" title="Настройки" aria-label="Настройки">⚙</button></div>
  </header>`;
}

function renderNavigation(): string {
  return `<nav class="navigation" aria-label="Разделы панели">${pages.map((page) => `<button class="nav-item ${activePage === page.id ? 'active' : ''}" data-page="${page.id}" ${activePage === page.id ? 'aria-current="page"' : ''}><span class="nav-icon">${page.icon}</span>${page.label}</button>`).join('')}<span class="nav-spacer"></span><span class="environment-tag"><span class="tiny-dot"></span>${state.status?.mode === 'router' ? 'Роутер' : 'Локальная среда'}</span></nav>`;
}

function metricCard(icon: string, label: string, value: string, note: string, tint: string): string {
  return `<article class="metric-card"><div class="metric-top"><span class="metric-icon ${tint}">${icon}</span><span class="metric-note">${note}</span></div><p>${label}</p><strong>${value}</strong></article>`;
}

function renderServiceCard(service: ServiceStatus): string {
  const icon = service.name === 'Xray' ? '✳' : service.name === 'Mihomo' ? '◉' : '⌂';
  const summary = service.version ? `Версия ${escapeHtml(service.version)}` : escapeHtml(service.detail);
  return `<article class="service-card"><div class="service-heading"><span class="service-icon">${icon}</span><div class="service-name"><strong>${escapeHtml(service.name)}</strong><small>${summary}</small></div>${serviceBadge(service)}</div><div class="service-foot"><span>${service.state === 'running' ? 'Работает' : service.state === 'unavailable' ? 'Проверка недоступна' : 'Нет подтверждения запуска'}</span><button class="text-button" disabled title="Управление сервисом появится после подключения системного адаптера">Подробнее <span>↗</span></button></div></article>`;
}

function renderOverview(): string {
  const status = state.status;
  const serviceCount = status?.services.filter((service) => service.state === 'running').length;
  const services = status?.services ?? [];
  const memory = status?.memory;
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> СИСТЕМА УПРАВЛЕНИЯ</div><h1>Обзор системы</h1><p>Состояние XKeen и доступность сетевых ядер в одном месте.</p></div><button class="button button-quiet" id="refresh-secondary"><span>↻</span> Обновить</button></section>
  ${state.error ? `<div class="alert alert-error"><span class="alert-icon">!</span><div><strong>${authRequired ? 'Нужен ключ доступа' : 'Нет связи с локальным API'}</strong><p>${escapeHtml(state.error)}${authRequired ? ' Введите ключ, который показал установщик.' : '. Убедитесь, что Rust backend запущен на порту 1001.'}</p></div><button class="text-button" id="${authRequired ? 'authenticate' : 'retry'}">${authRequired ? 'Войти' : 'Повторить'}</button></div>` : ''}
  ${status?.mode === 'simulation' ? `<div class="alert alert-info"><span class="alert-icon">i</span><div><strong>Режим разработки</strong><p>${escapeHtml(status.notice)} Состояния компонентов не подменяются демонстрационными значениями.</p></div><span class="alert-tag">SIMULATION</span></div>` : ''}
  <div class="metric-grid">
    ${metricCard('◉', 'Сервисы активны', status ? `${serviceCount ?? 0} / ${services.length}` : '—', 'фактический статус', 'mint')}
    ${metricCard('▤', 'Память', memory ? `${memory.usedMb} / ${memory.totalMb} MB` : 'Недоступна', 'по данным ОС', 'blue')}
    ${metricCard('⌁', 'Платформа', status ? escapeHtml(status.platform) : 'Определяется', status?.loadAverage === null || status?.loadAverage === undefined ? 'нагрузка недоступна' : `load avg ${status.loadAverage.toFixed(2)}`, 'violet')}
    ${metricCard('◷', 'Работа панели', status ? formatUptime(status.uptimeSeconds) : '—', 'текущая сессия', 'violet')}
    ${metricCard('⌖', 'API', state.connected ? `:${status?.port ?? 1001}` : 'Ожидание', state.connected ? 'соединение активно' : 'нет соединения', 'amber')}
  </div>
  <section class="content-section"><div class="section-title"><div><h2>Сетевые компоненты</h2><p>Статусы поступают из backend и не заменяются фиктивными данными.</p></div><span class="section-counter">${services.length} компонента</span></div><div class="service-grid">${services.length ? services.map(renderServiceCard).join('') : emptyCard('Пока нет данных о компонентах', 'Подключите backend; он сообщит только значения, полученные из системы.')}</div></section>
  <section class="content-section"><div class="section-title"><div><h2>Быстрый переход</h2><p>Разделы станут доступны по мере подключения проверенных API.</p></div></div><div class="quick-grid">${[['⇄','Селекторы','Группы и выбор узлов','selectors'],['◎','DNS','Параметры разрешения имён','dns'],['⌘','Конфигурация','Проверка и применение профилей','configuration']].map(([icon,title,sub,page])=>`<button class="quick-card" data-page="${page}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${sub}</small></span><span class="quick-arrow">↗</span></button>`).join('')}</div></section>`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function emptyCard(title: string, body: string): string {
  return `<div class="empty-card"><span class="empty-icon">◌</span><strong>${title}</strong><p>${body}</p></div>`;
}

function renderComingSoon(page: Page): string {
  const current = pages.find((item) => item.id === page);
  if (page === 'configuration') return renderConfiguration();
  const descriptions: Record<Page, string> = {
    overview: '',
    selectors: 'Подключите проверенный Mihomo API, чтобы показывать фактические группы, узлы и выбранные значения.',
    connections: 'Здесь появятся соединения, источники, цепочки прокси и объёмы трафика из runtime API ядра.',
    dns: 'Управление DNS будет раздельным для Mihomo и Xray, с проверкой конфигурации и безопасным применением.',
    configuration: 'Редактор профилей появится после подключения YAML/JSON валидаторов и сценария резервного копирования.',
    logs: 'Журнал будет читать локальные источники и фильтровать записи без передачи секретов в интерфейс.',
  };
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> XKeen UI</div><h1>${current?.label ?? ''}</h1><p>${descriptions[page]}</p></div></section><section class="feature-placeholder"><div class="placeholder-symbol">${current?.icon ?? '◌'}</div><div class="placeholder-copy"><span class="status-label">ИНТЕГРАЦИЯ ЯДРА</span><h2>Для этого раздела ещё не подключён проверенный API</h2><p>${descriptions[page]}</p><p class="placeholder-note">Данные появятся после подключения подтверждённого системного источника.</p></div></section>`;
}

function renderConfiguration(): string {
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> РАБОЧАЯ ОБЛАСТЬ</div><h1>Конфигурация</h1><p>Изолированные черновики файлов и списков XKeen без доступа к файлам роутера.</p></div><span class="runtime-badge"><span class="runtime-dot"></span> Режим черновика</span></section>
  <section class="editor-workspace" aria-label="Редактор конфигурации Mihomo">
    <div class="config-file-tabs" role="group" aria-label="Файлы конфигурации">${[['config','config'],['ip_exclude','ip_exclude'],['port_exclude','port_exclude'],['port_proxying','port_proxying'],['xkeen','xkeen'],['xray_json','Xray JSON'],['xray_jsonc','Xray JSONC']].map(([id,label]) => `<button class="config-file-tab" data-config-file="${id}" type="button" aria-pressed="${id === 'config'}">${label}</button>`).join('')}</div>
    <div class="editor-toolbar"><div class="editor-file"><span class="file-mark">⌘</span><div><strong id="editor-filename">config.yaml</strong><small id="editor-file-hint">Локальная вкладка · не файл роутера</small></div><span class="draft-pill">Черновик</span></div><div class="editor-actions"><button class="editor-button" id="yaml-template" data-yaml-only title="Загрузить пример в редактор">Шаблон</button><button class="editor-button" id="yaml-validate" data-structured-only><span>✓</span> Проверить</button><button class="editor-button" id="yaml-format" data-structured-only><span>⌘</span> Формат</button><button class="editor-button editor-button-primary" id="yaml-download"><span>↓</span> Скачать</button></div></div>
    <div class="editor-callout"><span class="callout-mark">i</span><p>Черновик хранится только в текущей вкладке браузера. Он не загружается и не применяется на роутере. Проверка проверяет YAML, но не схему конкретной версии Mihomo.</p></div>
    <div class="code-editor-shell"><div class="editor-gutter-label" id="editor-language">YAML · Mihomo</div><div class="code-editor" id="yaml-editor" aria-label="Текст локального черновика конфигурации"></div></div>
    <div class="editor-statusbar"><span id="yaml-validation" class="editor-validation">Черновик пуст</span><span class="editor-encoding">UTF-8 <span>·</span> YAML 1.2 <span>·</span> Mihomo</span></div>
  </section>
  <section class="editor-next-step"><span>◇</span><div><strong>Подключение к конфигурации роутера</strong><p>Чтение и безопасное применение появятся после Rust API с резервной копией, блокировкой пути и подтверждённым откатом.</p></div><span class="coming-tag">НЕ ПОДКЛЮЧЕНО</span></section>`;
}

function renderFooter(): string {
  return `<footer class="footer"><span><span class="footer-mark">✳</span> XKeen UI <span class="footer-muted">· первая версия</span></span><span>${state.connected ? 'Backend отвечает' : 'Backend не подключён'} <span class="footer-indicator ${state.connected ? 'is-online' : ''}"></span></span></footer>`;
}

function render(): void {
  if (!app) return;
  if (activePage !== 'configuration' || authRequired) unmountYamlEditor();
  const pageContent = authRequired || activePage === 'overview' ? renderOverview()
    : activePage === 'selectors' ? renderSelectors(selectors, selectorsLoading, selectorsError)
      : activePage === 'connections' ? renderConnections(connections, connectionsLoading, connectionsError)
        : activePage === 'dns' ? renderDns(dnsResult, dnsLoading, dnsError, dnsQueryName, dnsQueryType)
        : renderComingSoon(activePage);
  app.innerHTML = `<div class="app-shell">${renderHeader()}${renderNavigation()}<main class="main-content">${pageContent}</main>${renderFooter()}<div class="toast-region" aria-live="polite"></div></div>`;
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
  document.querySelector<HTMLButtonElement>('#authenticate')?.addEventListener('click', openAccessDialog);
  document.querySelector<HTMLFormElement>('#dns-query-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    dnsQueryName = String(data.get('name') ?? '').trim();
    dnsQueryType = String(data.get('type') ?? 'A');
    void runDnsQuery();
  });
  if (activePage === 'configuration' && !authRequired) mountYamlEditor();
  bindMihomoInteractions();
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
  modal.innerHTML = `<form method="dialog" class="modal-panel"><div class="modal-heading"><span class="modal-icon">⚙</span><h2>Настройки панели</h2><button class="icon-button" aria-label="Закрыть">×</button></div><div class="modal-tabs" role="tablist" aria-label="Разделы настроек"><button class="settings-tab selected" id="settings-general" type="button" role="tab" aria-selected="true">Общие</button><button class="settings-tab" id="settings-security" type="button" role="tab" aria-selected="false">Безопасность</button></div><div id="settings-content" role="tabpanel"></div><button class="button button-primary modal-close">Готово</button></form>`;
  document.body.append(modal);
  modal.showModal();
  const content = modal.querySelector<HTMLElement>('#settings-content');
  const renderSettingsTab = (tab: 'general' | 'security') => {
    modal.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
      const selected = button.id === `settings-${tab}`;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (!content) return;
    if (tab === 'general') {
      content.innerHTML = `<div class="setting-row"><div><strong>Порт панели</strong><small>Адрес локального Rust API и интерфейса</small></div><span class="setting-value">${state.status?.port ?? 1001}</span></div><div class="setting-row"><div><strong>Backend</strong><small>${state.connected ? 'Соединение установлено' : 'Соединение отсутствует'}</small></div><span class="state-pill ${state.connected ? 'state-running' : 'state-unavailable'}">${state.connected ? 'На связи' : 'Ожидание'}</span></div><div class="setting-row"><div><strong>Режим</strong><small>Источник системных сведений</small></div><span class="setting-value">${state.status?.mode === 'router' ? 'Роутер' : 'Симуляция'}</span></div><div class="setting-row"><div><strong>Версия XKeen UI</strong><small>Сборка панели</small></div><span class="setting-value">${escapeHtml(state.status?.appVersion ?? '0.1.0')}</span></div>`;
      return;
    }
    const tokenPresent = hasAccessToken();
    content.innerHTML = `<div class="setting-row"><div><strong>Ключ API</strong><small>${tokenPresent ? 'Хранится только в sessionStorage этой вкладки' : 'Ключ этой вкладки не сохранён'}</small></div><span class="state-pill ${tokenPresent ? 'state-running' : 'state-unavailable'}">${tokenPresent ? 'Установлен' : 'Не задан'}</span></div><div class="security-actions"><button class="editor-button" id="replace-token">${tokenPresent ? 'Заменить ключ' : 'Добавить ключ'}</button>${tokenPresent ? '<button class="editor-button danger-button" id="forget-token">Забыть ключ</button>' : ''}</div><p class="modal-note">Секрет не отображается и не записывается в localStorage.${tokenPresent ? ' Удаление ключа отключит запросы к защищённому API.' : ''}</p>`;
    modal.querySelector<HTMLButtonElement>('#replace-token')?.addEventListener('click', () => { modal.close(); openAccessDialog(); });
    modal.querySelector<HTMLButtonElement>('#forget-token')?.addEventListener('click', () => { setAccessToken(null); modal.close(); void refresh(); });
  };
  modal.querySelector<HTMLButtonElement>('#settings-general')?.addEventListener('click', () => renderSettingsTab('general'));
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
}

render();
void refresh();
refreshTimer = window.setInterval(() => void refresh(), 15_000);
window.addEventListener('beforeunload', () => {
  requestController?.abort();
  mihomoController?.abort();
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
