import { getMihomoProxyProviders, refreshMihomoProxyProvider, type MihomoProxyProvider } from './api';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';

const relativeTime = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatSubscriptionTraffic(info: Pick<MihomoProxyProvider, 'upload' | 'download' | 'total'>): string {
  const used = info.upload + info.download;
  if (info.total > 0) return `${formatBytes(used)} / ${formatBytes(info.total)}`;
  return used > 0 ? formatBytes(used) : '—';
}

function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const exponent = safe > 0 ? Math.min(Math.floor(Math.log2(safe) / 10), byteUnits.length - 1) : 0;
  const value = safe / 1024 ** exponent;
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2 }).format(value);
  return `${formatted} ${byteUnits[exponent]}`;
}

export function formatSubscriptionExpiry(expire: number | null): string {
  if (expire === null || !Number.isFinite(expire) || expire <= 0) return '—';
  const date = new Date(expire * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatProviderUpdated(value: string | number | null, now = Date.now()): string {
  if (value === null || (typeof value === 'string' && value.startsWith('0001-01-01'))) return '—';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return '—';
  const elapsed = Math.max(0, (now - date.getTime()) / 1000);
  if (elapsed < 45) return 'только что';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, seconds] = units.find(([, length]) => elapsed >= length) ?? units[units.length - 1]!;
  return relativeTime.format(-Math.round(elapsed / seconds), unit);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function icon(name: 'eye' | 'refresh'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (name === 'eye') {
    svg.innerHTML = '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>';
  } else {
    svg.innerHTML = '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/>';
  }
  return svg;
}

function renderProviders(target: HTMLElement, providers: MihomoProxyProvider[], query: string, onView: (provider: MihomoProxyProvider) => void, onRefresh: (provider: MihomoProxyProvider) => void, onRefreshAll: () => void, busy: Set<string>): void {
  const normalized = query.trim().toLocaleLowerCase('ru');
  const visible = providers.filter((provider) => `${provider.name} ${provider.vehicleType}`.toLocaleLowerCase('ru').includes(normalized));
  target.replaceChildren();
  if (!visible.length) {
    target.append(element('p', 'subscriptions-empty', providers.length ? 'Подписки не найдены по этому фильтру.' : 'В конфигурации нет HTTP-подписок Mihomo. Добавьте URL через «Добавить подключение».'));
    return;
  }
  const table = element('table', 'subscriptions-table');
  const head = element('thead');
  const header = element('tr');
  for (const title of ['Название', 'Тип', 'Трафик', 'Истекает', 'Обновлено']) header.append(element('th', undefined, title));
  const refreshAllCell = element('th', 'subscriptions-actions');
  const refreshAll = element('button', 'subscription-action', '');
  refreshAll.type = 'button';
  refreshAll.setAttribute('aria-label', 'Обновить все подписки');
  refreshAll.title = 'Обновить все подписки';
  refreshAll.append(icon('refresh'));
  refreshAll.disabled = busy.size > 0;
  refreshAll.addEventListener('click', onRefreshAll);
  refreshAllCell.append(refreshAll);
  header.append(refreshAllCell);
  head.append(header);
  table.append(head);
  const body = element('tbody');
  for (const provider of visible) {
    const row = element('tr');
    const nameCell = element('td', 'subscription-name');
    const nameLine = element('span', 'subscription-name-line');
    nameLine.append(element('span', 'subscription-name-text', provider.name), element('span', 'subscription-count', String(provider.proxyCount)));
    nameCell.append(nameLine);
    row.append(nameCell);
    const typeCell = element('td');
    typeCell.append(element('span', 'subscription-type', provider.vehicleType.toLowerCase() === 'http' ? 'Http' : provider.vehicleType));
    row.append(typeCell, element('td', 'subscription-traffic', formatSubscriptionTraffic(provider)));
    const expiry = element('td', 'subscription-expiry', formatSubscriptionExpiry(provider.expire));
    if (provider.expire !== null && provider.expire * 1000 < Date.now()) expiry.classList.add('is-expired');
    row.append(expiry, element('td', 'subscription-updated', formatProviderUpdated(provider.updatedAt)));
    const actions = element('td', 'subscriptions-actions');
    const view = element('button', 'subscription-action', '');
    view.type = 'button'; view.setAttribute('aria-label', `Показать узлы подписки ${provider.name}`); view.title = 'Посмотреть узлы'; view.append(icon('eye'));
    view.addEventListener('click', () => onView(provider));
    const refresh = element('button', 'subscription-action', '');
    refresh.type = 'button'; refresh.setAttribute('aria-label', `Обновить подписку ${provider.name}`); refresh.title = 'Обновить подписку'; refresh.append(icon('refresh'));
    refresh.disabled = busy.has(provider.name) || busy.size > 0;
    refresh.classList.toggle('is-busy', busy.has(provider.name));
    refresh.addEventListener('click', () => onRefresh(provider));
    actions.append(view, refresh);
    row.append(actions);
    body.append(row);
  }
  table.append(body);
  target.append(table);
}

export async function openSubscriptionsDialog(): Promise<void> {
  const dialog = element('dialog', 'modal subscriptions-dialog');
  dialog.innerHTML = `<section class="modal-panel subscriptions-panel"><header class="modal-heading"><span class="subscriptions-title-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg></span><h2>Провайдеры прокси</h2><button class="icon-button subscriptions-close" type="button" aria-label="Закрыть">×</button></header><label class="subscriptions-filter"><span class="visually-hidden">Фильтр подписок</span><input type="search" placeholder="Фильтр" autocomplete="off"></label><p class="subscriptions-status" role="status" aria-live="polite">Загрузка подписок…</p><div class="subscriptions-list"></div><section class="subscription-nodes" hidden><header><div><strong></strong><small></small></div><button class="subscription-nodes-close" type="button" aria-label="Закрыть список узлов">×</button></header><ul></ul></section></section>`;
  document.body.append(dialog);
  bindDialogMotion(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector<HTMLButtonElement>('.subscriptions-close')?.addEventListener('click', () => closeDialogWithMotion(dialog));
  const filter = dialog.querySelector<HTMLInputElement>('.subscriptions-filter input')!;
  const list = dialog.querySelector<HTMLElement>('.subscriptions-list')!;
  const status = dialog.querySelector<HTMLElement>('.subscriptions-status')!;
  const nodePanel = dialog.querySelector<HTMLElement>('.subscription-nodes')!;
  const nodeTitle = nodePanel.querySelector<HTMLElement>('strong')!;
  const nodeSummary = nodePanel.querySelector<HTMLElement>('small')!;
  const nodeList = nodePanel.querySelector<HTMLUListElement>('ul')!;
  let providers: MihomoProxyProvider[] = [];
  const busy = new Set<string>();
  const showNodes = (provider: MihomoProxyProvider) => {
    nodeTitle.textContent = provider.name;
    nodeSummary.textContent = `${provider.proxyCount} узлов · ${provider.vehicleType}`;
    nodeList.replaceChildren();
    if (!provider.proxies.length) nodeList.append(element('li', 'subscription-node-empty', 'Mihomo пока не вернул список узлов для этой подписки.'));
    for (const proxy of provider.proxies) {
      const row = element('li', 'subscription-node');
      row.append(element('span', undefined, proxy.name), element('small', undefined, proxy.type));
      nodeList.append(row);
    }
    nodePanel.hidden = false;
  };
  const render = () => renderProviders(list, providers, filter.value, showNodes, refreshProvider, refreshAllProviders, busy);
  const load = async () => {
    status.textContent = 'Загружаем подписки из активной конфигурации Mihomo…';
    try {
      providers = await getMihomoProxyProviders();
      status.textContent = `${providers.length} подписок из активной конфигурации Mihomo`;
      render();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось получить список подписок.';
    }
  };
  async function refreshProvider(provider: MihomoProxyProvider): Promise<void> {
    await refreshMany([provider]);
  }
  async function refreshAllProviders(): Promise<void> {
    await refreshMany(providers.filter((provider) => `${provider.name} ${provider.vehicleType}`.toLocaleLowerCase('ru').includes(filter.value.trim().toLocaleLowerCase('ru'))));
  }
  async function refreshMany(items: MihomoProxyProvider[]): Promise<void> {
    if (busy.size || !items.length) return;
    items.forEach((provider) => busy.add(provider.name));
    render();
    try {
      const results = await Promise.allSettled(items.map((provider) => refreshMihomoProxyProvider(provider.name)));
      await load();
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      status.textContent = failed
        ? `Не все подписки обновлены: ${failed.reason instanceof Error ? failed.reason.message : 'ошибка запроса'}`
        : items.length === 1 ? `Запрос на обновление «${items[0]!.name}» отправлен.` : `Запросы на обновление отправлены: ${items.length}.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось обновить подписки.';
    } finally {
      items.forEach((provider) => busy.delete(provider.name));
      render();
    }
  }
  filter.addEventListener('input', render);
  dialog.querySelector<HTMLButtonElement>('.subscription-nodes-close')?.addEventListener('click', () => { nodePanel.hidden = true; });
  await load();
}
