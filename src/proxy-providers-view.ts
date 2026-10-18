interface ProxyProviderNode {
  name: string;
  type: string;
}

export interface ProxyProviderView {
  name: string;
  type: string;
  proxies: ProxyProviderNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function parseProxyProviders(payload: unknown): ProxyProviderView[] {
  if (!isRecord(payload) || !isRecord(payload.providers)) throw new Error('Mihomo вернул некорректный список провайдеров');
  return Object.entries(payload.providers).map(([name, raw]) => {
    if (!isRecord(raw) || !Array.isArray(raw.proxies)) throw new Error(`Mihomo вернул некорректного провайдера «${name}»`);
    const proxies = raw.proxies.flatMap((proxy): ProxyProviderNode[] => {
      if (!isRecord(proxy) || typeof proxy.name !== 'string') return [];
      return [{ name: proxy.name, type: typeof proxy.type === 'string' ? proxy.type : 'Unknown' }];
    });
    return { name, type: typeof raw.vehicleType === 'string' ? raw.vehicleType : typeof raw.type === 'string' ? raw.type : 'Provider', proxies };
  });
}

function nodeCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? 'узел' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'узла' : 'узлов';
  return `${count} ${noun}`;
}

export function renderProxyProviders(providers: ProxyProviderView[], loading: boolean, error: string | null): string {
  if (loading) return '<section class="proxy-providers-panel" aria-busy="true"><h1>Прокси-подписки</h1><div class="proxy-providers-state"><span class="loading-orbit" aria-hidden="true"></span>Загрузка провайдеров Mihomo…</div></section>';
  if (error) return `<section class="proxy-providers-panel"><h1>Прокси-подписки</h1><div class="proxy-providers-state is-error"><strong>Не удалось загрузить подписки</strong><p>${escapeHtml(error)}</p><button class="button button-quiet" id="proxy-providers-retry" type="button">Повторить</button></div></section>`;
  if (!providers.length) return '<section class="proxy-providers-panel"><header><div><h1>Прокси-подписки</h1><p>Список текущих источников и загруженных узлов Mihomo.</p></div><button class="button button-primary" data-page="configuration" type="button">Добавить подписку</button></header><div class="proxy-providers-state"><strong>Провайдеры прокси не найдены</strong><p>В конфигурации выберите Конфигурация → Утилиты → Добавить прокси, укажите группы и примените конфиг. До применения изменения останутся черновиком.</p></div></section>';
  return `<section class="proxy-providers-panel"><header><div><h1>Прокси-подписки</h1><p>Источники и узлы, загруженные текущей конфигурацией Mihomo.</p></div><div class="proxy-providers-actions"><button class="button button-primary" data-page="configuration" type="button">Добавить подписку</button><button class="button button-quiet" id="proxy-providers-retry" type="button">Обновить список</button></div></header><div class="proxy-providers-list">${providers.map((provider) => `<article class="proxy-provider-card"><div class="proxy-provider-card-heading"><div><h2>${escapeHtml(provider.name)}</h2><span>${escapeHtml(provider.type)}</span></div><strong>${nodeCount(provider.proxies.length)}</strong></div>${provider.proxies.length ? `<ul>${provider.proxies.map((proxy) => `<li><span>${escapeHtml(proxy.name)}</span><small>${escapeHtml(proxy.type)}</small></li>`).join('')}</ul>` : '<p class="proxy-provider-empty">Mihomo пока не вернул узлы для этого источника.</p>'}</article>`).join('')}</div></section>`;
}
