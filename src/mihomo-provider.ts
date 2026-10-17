import { isMap, parseDocument, stringify } from 'yaml';

export type MihomoProviderPosition = 'start' | 'end' | 'replace';

export function nextMihomoProviderName(source: string): string {
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length) throw new Error(`Текущий YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  const providers = document.get('proxy-providers', true);
  if (providers !== undefined && !isMap(providers)) throw new Error('Поле proxy-providers в конфигурации должно быть объектом');
  let index = 1;
  while (isMap(providers) && providers.has(`subscription_${index}`)) index += 1;
  return `subscription_${index}`;
}

export interface MihomoProviderSettings {
  name: string;
  url: string;
  interval: number;
  healthCheckEnabled: boolean;
  healthCheckUrl: string;
  healthCheckInterval: number;
  expectedStatus: number;
  headersEnabled: boolean;
  userAgent: string;
  hwid: string;
  udp: boolean;
  filtersEnabled: boolean;
  filter: string;
  excludeFilter: string;
  excludeType: string;
}

function validateWebUrl(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label}: укажите полный URL с http:// или https://`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error(`${label}: поддерживаются только HTTP и HTTPS`);
  return url.toString();
}

/** Serialize editable Mihomo proxy-provider settings into a one-entry YAML map. */
export function createMihomoProviderYaml(settings: MihomoProviderSettings): string {
  const name = settings.name.trim();
  if (!name || !/^[\w.-]+$/.test(name)) throw new Error('Имя провайдера может содержать латинские буквы, цифры, точку, дефис и подчёркивание');
  const url = validateWebUrl(settings.url.trim(), 'Ссылка на подписку');
  const numericSettings = [
    ['Интервал обновления', settings.interval, 60, 2147483647],
    ...(settings.healthCheckEnabled ? [
      ['Интервал проверки', settings.healthCheckInterval, 1, 2147483647],
      ['Ожидаемый HTTP-код', settings.expectedStatus, 100, 599],
    ] as const : []),
  ] as const;
  for (const [label, value, min, max] of numericSettings) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: значение вне допустимого диапазона`);
  }

  const provider: Record<string, unknown> = { type: 'http', url, interval: settings.interval };
  if (settings.healthCheckEnabled) {
    provider['health-check'] = {
      enable: true,
      url: validateWebUrl(settings.healthCheckUrl.trim(), 'URL проверки'),
      interval: settings.healthCheckInterval,
      'expected-status': settings.expectedStatus,
    };
  }
  if (settings.headersEnabled) {
    const header: Record<string, string[]> = {};
    if (settings.userAgent.trim()) header['User-Agent'] = [settings.userAgent.trim()];
    if (settings.hwid.trim()) header['x-hwid'] = [settings.hwid.trim()];
    if (Object.keys(header).length) provider.header = header;
  }
  if (settings.udp) provider.override = { udp: true };
  if (settings.filtersEnabled) {
    if (settings.filter.trim()) provider.filter = settings.filter.trim();
    if (settings.excludeFilter.trim()) provider['exclude-filter'] = settings.excludeFilter.trim();
    if (settings.excludeType.trim()) provider['exclude-type'] = settings.excludeType.trim();
  }
  return stringify({ [name]: provider }, { indent: 2, lineWidth: 0 });
}

/** Add one parsed subscription provider to config.yaml without changing unrelated sections. */
export function insertMihomoProvider(
  source: string,
  generatedProvider: string,
  position: MihomoProviderPosition,
  replaceName?: string,
): string {
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length) throw new Error(`Текущий YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  if (!isMap(document.contents)) throw new Error('Ожидается YAML-объект конфигурации Mihomo');

  const generated = parseDocument(generatedProvider, { uniqueKeys: true, version: '1.2' });
  if (generated.errors.length) throw new Error('Не удалось прочитать YAML провайдера подписки');
  if (!isMap(generated.contents) || generated.contents.items.length !== 1) {
    throw new Error('Для добавления нужен один корректный провайдер подписки');
  }

  const [entry] = generated.contents.items;
  if (!entry || entry.key == null || entry.value == null) throw new Error('Провайдер подписки не содержит настроек');
  const name = String(entry.key.toJSON());
  const providers = document.get('proxy-providers', true);
  if (providers !== undefined && !isMap(providers)) throw new Error('Поле proxy-providers в конфигурации должно быть объектом');

  let providerMap = providers;
  if (!providerMap) {
    const created = document.createNode({});
    if (!isMap(created)) throw new Error('Не удалось создать список провайдеров');
    providerMap = created;
    document.set('proxy-providers', providerMap);
  }

  if (position === 'replace') {
    if (!replaceName || !providerMap.has(replaceName)) throw new Error('Выберите существующий провайдер для замены');
    providerMap.set(replaceName, document.createNode((entry.value as { toJSON(): unknown }).toJSON()));
    return document.toString({ indent: 2, lineWidth: 0 });
  }

  if (providerMap.has(name)) throw new Error(`Провайдер «${name}» уже существует`);
  providerMap.set(name, document.createNode((entry.value as { toJSON(): unknown }).toJSON()));
  if (position === 'start') {
    const index = providerMap.items.findIndex((item) => {
      const key = (item as { key?: unknown }).key;
      const value = key && typeof key === 'object' && 'toJSON' in key && typeof key.toJSON === 'function'
        ? key.toJSON()
        : key;
      return String(value) === name;
    });
    if (index > 0) providerMap.items.unshift(...providerMap.items.splice(index, 1));
  }
  return document.toString({ indent: 2, lineWidth: 0 });
}
