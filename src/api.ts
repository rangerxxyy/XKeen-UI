export interface ServiceStatus {
  name: string;
  state: 'running' | 'stopped' | 'unavailable' | 'unknown';
  version: string | null;
  detail: string;
}

export interface SystemStatus {
  appVersion: string;
  mode: 'simulation' | 'router';
  port: number;
  uptimeSeconds: number;
  platform: string;
  memory: { usedMb: number; totalMb: number } | null;
  loadAverage: number | null;
  cpuPercent: number | null;
  services: ServiceStatus[];
  notice: string;
}

export interface XkeenStatus {
  installed: boolean;
  running: boolean | null;
  version: string | null;
  core: 'mihomo' | 'xray' | null;
  initPath: string | null;
  detail: string;
}

export interface CoreSources {
  xray: string;
  mihomo: string;
}

export interface UpdateProxies {
  proxies: string[];
}

export interface CoreInstallResult {
  core: 'xray' | 'mihomo';
  tag: string;
  backup: string | null;
  restarted: boolean;
  detail: string;
}

export interface SystemLog {
  file: string;
  lines: string[];
  truncated: boolean;
}

export interface ApiState {
  connected: boolean;
  status: SystemStatus | null;
  error: string | null;
  checkedAt: Date | null;
}

export interface MihomoProxyOption {
  name: string;
  type: string;
  icon: string | null;
  alive: boolean | null;
  delay: number | null;
  udp?: boolean;
  xudp?: boolean;
}

export interface MihomoSelector {
  name: string;
  type?: string;
  icon: string | null;
  current: string | null;
  options: MihomoProxyOption[];
}

export interface MihomoPingResult {
  name: string;
  delay: number | null;
}

export interface MihomoPingOptions {
  url: string;
  timeoutMs: number;
}

export async function pingMihomoGroup(group: string, options?: MihomoPingOptions, signal?: AbortSignal): Promise<MihomoPingResult[]> {
  const response = await fetch('/api/v1/mihomo/proxies/ping', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, ...(options ? { url: options.url, timeoutMs: options.timeoutMs } : {}) }),
    signal,
  });
  const payload = await readJson(response, 'Проверка серверов группы');
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error('Backend вернул некорректные результаты ping');
  return payload.results.flatMap((raw): MihomoPingResult[] => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !(raw.delay === null || (typeof raw.delay === 'number' && Number.isFinite(raw.delay)))) return [];
    return [{ name: raw.name, delay: raw.delay }];
  });
}

export async function pingMihomoProxy(group: string, name: string, options?: MihomoPingOptions, signal?: AbortSignal): Promise<MihomoPingResult | null> {
  const response = await fetch('/api/v1/mihomo/proxies/ping-one', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, name, ...(options ? { url: options.url, timeoutMs: options.timeoutMs } : {}) }),
    signal,
  });
  const payload = await readJson(response, 'Проверка узла');
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error('Backend вернул некорректные результаты ping');
  const raw = payload.results.find((result) => isRecord(result) && result.name === name);
  if (!isRecord(raw) || !(raw.delay === null || (typeof raw.delay === 'number' && Number.isFinite(raw.delay)))) return null;
  return { name, delay: raw.delay };
}

export interface MihomoConnections {
  uploadTotal: number;
  downloadTotal: number;
  connections: MihomoConnection[];
}

export interface MihomoConnection {
  id: string;
  host: string;
  destination: string;
  destinationPort?: number;
  source: string;
  sourceIp?: string;
  network: string;
  process: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: number;
  download: number;
  start: string;
}

export async function getRouterDeviceList(signal?: AbortSignal): Promise<unknown> {
  const response = await fetch('/api/v1/router/devices', {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload = await readJson(response, 'Получение списка устройств KeeneticOS');
  if (!isRecord(payload) || !Array.isArray(payload.host)) {
    throw new Error('Backend вернул некорректный список устройств KeeneticOS');
  }
  return payload;
}

export interface RouterDnsStatus {
  dnsOverride: boolean;
  mihomoDns: boolean;
  portListener: string | null;
  nameServers: string[];
  detail: string;
}

export async function getRouterDnsStatus(signal?: AbortSignal): Promise<RouterDnsStatus> {
  const payload = await getMihomoJson('/api/v1/dns', 'Получение состояния DNS роутера', signal);
  if (!isRecord(payload) || typeof payload.dnsOverride !== 'boolean' || typeof payload.mihomoDns !== 'boolean'
    || !(payload.portListener === null || typeof payload.portListener === 'string')
    || !Array.isArray(payload.nameServers) || !payload.nameServers.every((value) => typeof value === 'string')
    || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректное состояние DNS роутера');
  }
  return payload as unknown as RouterDnsStatus;
}

export async function setRouterDnsManagement(request: {
  enabled: boolean;
  expectedContent: string;
}, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/v1/dns', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  await readJson(response, request.enabled ? 'Передача DNS Mihomo' : 'Возврат DNS KeeneticOS');
}

export interface MihomoDnsRecord {
  name: string;
  type: string;
  ttl: number | null;
  data: string;
}

export interface MihomoDnsResult {
  status: string;
  answers: MihomoDnsRecord[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getStatus(signal?: AbortSignal): Promise<SystemStatus> {
  const response = await fetch('/api/v1/status', {
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseSystemStatus(await readJson(response, 'Получение статуса'));
}

export async function requestAppUpdate(tag: string): Promise<void> {
  const response = await fetch('/api/v1/app/update', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
  const payload = await readJson(response, 'Обновление XKeen UI');
  if (!isRecord(payload) || payload.status !== 'started') {
    throw new Error('Backend не подтвердил запуск обновления панели');
  }
}

export async function getMihomoSelectors(signal?: AbortSignal): Promise<MihomoSelector[]> {
  const [payload, providerPayload] = await Promise.all([
    getMihomoJson('/api/v1/mihomo/proxies', 'Получение селекторов', signal),
    getMihomoJson('/api/v1/mihomo/providers/proxies', 'Получение узлов подписок', signal).catch(() => null),
  ]);
  if (!isRecord(payload) || !isRecord(payload.proxies)) {
    throw new Error('Mihomo вернул некорректный список прокси');
  }
  const proxies: UnknownRecord = { ...payload.proxies };
  // Mihomo may omit subscription proxies from /proxies even while selectors
  // still reference them. The zxc-rv UI fills those gaps from providers/proxies.
  if (isRecord(providerPayload) && isRecord(providerPayload.providers)) {
    for (const provider of Object.values(providerPayload.providers)) {
      if (!isRecord(provider) || !Array.isArray(provider.proxies)) continue;
      for (const option of provider.proxies) {
        if (isRecord(option) && typeof option.name === 'string' && !isRecord(proxies[option.name])) {
          proxies[option.name] = option;
        }
      }
    }
  }
  return Object.entries(proxies).flatMap(([key, raw]): MihomoSelector[] => {
    if (!isRecord(raw) || !['Selector', 'URLTest', 'Fallback', 'LoadBalance'].includes(String(raw.type)) || !Array.isArray(raw.all)) return [];
    const options = raw.all.flatMap((name): MihomoProxyOption[] => {
      if (typeof name !== 'string') return [];
      const option = proxies[name];
      // Match Mihomo's runtime map: groups may keep stale names in `all` after
      // a provider refresh, but without a proxy object they cannot be shown,
      // pinged, or selected reliably.
      if (!isRecord(option)) return [];
      const history = isRecord(option) && Array.isArray(option.history) ? option.history : [];
      const latest = history.at(-1);
      const delay = isRecord(latest) && typeof latest.delay === 'number' && Number.isFinite(latest.delay)
        ? latest.delay : null;
      return [{
        name,
        type: isRecord(option) && typeof option.type === 'string' ? option.type : 'Unknown',
        icon: isRecord(option) && typeof option.icon === 'string' ? option.icon : null,
        alive: isRecord(option) && typeof option.alive === 'boolean' ? option.alive : null,
        delay,
        ...(typeof option.udp === 'boolean' ? { udp: option.udp } : {}),
        ...(typeof option.xudp === 'boolean' ? { xudp: option.xudp } : {}),
      }];
    });
    return [{ name: typeof raw.name === 'string' ? raw.name : key, type: String(raw.type), icon: typeof raw.icon === 'string' ? raw.icon : null, current: typeof raw.now === 'string' ? raw.now : null, options }];
  });
}

export interface ActiveConfig {
  core: 'mihomo';
  path: string;
  content: string;
  modified: string | null;
}

export interface MihomoConfigBackup { id: string; size: number; modified: number }

export async function listMihomoConfigBackups(signal?: AbortSignal): Promise<MihomoConfigBackup[]> {
  const payload = await getMihomoJson('/api/v1/config/backups', 'Загрузка резервных копий Mihomo', signal);
  if (!isRecord(payload) || !Array.isArray(payload.backups) || payload.backups.length > 100 || payload.backups.some((item) =>
    !isRecord(item) || typeof item.id !== 'string' || !/^\.mihomo-config-\d+-\d+\.yaml$/.test(item.id) ||
    typeof item.size !== 'number' || item.size < 0 || item.size > 4 * 1024 * 1024 ||
    typeof item.modified !== 'number' || item.modified < 0)) {
    throw new Error('Backend вернул некорректный список резервных копий Mihomo');
  }
  return payload.backups as MihomoConfigBackup[];
}

export async function restoreMihomoConfigBackup(backupId: string, expectedContent: string, signal?: AbortSignal): Promise<ApplyMihomoConfigResult> {
  if (!/^\.mihomo-config-\d+-\d+\.yaml$/.test(backupId)) throw new Error('Некорректный идентификатор резервной копии');
  const response = await fetch('/api/v1/config/backups/restore', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupId, expectedContent }), signal,
  });
  const payload = await readJson(response, 'Восстановление конфигурации Mihomo');
  if (!isRecord(payload) || payload.status !== 'applied' || payload.path !== '/opt/etc/mihomo/config.yaml' ||
      typeof payload.backup !== 'string' || typeof payload.restarted !== 'boolean' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат восстановления конфигурации');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xkeen-config-applied'));
  return { status: 'applied', path: payload.path, backup: payload.backup, restarted: payload.restarted, detail: payload.detail };
}

export async function getActiveMihomoConfig(signal?: AbortSignal): Promise<ActiveConfig> {
  const payload = await getMihomoJson('/api/v1/config/active?core=mihomo', 'Чтение активной конфигурации', signal);
  if (!isRecord(payload) || payload.core !== 'mihomo' || typeof payload.path !== 'string' || typeof payload.content !== 'string') {
    throw new Error('Backend вернул некорректную активную конфигурацию');
  }
  return { core: 'mihomo', path: payload.path, content: payload.content, modified: typeof payload.modified === 'string' ? payload.modified : null };
}

export type RouterConfigFile = 'ip_exclude' | 'port_exclude' | 'port_proxying' | 'xkeen';
export type XrayConfigFile = 'xray_outbounds' | 'xray_routing';
const routerConfigPaths: Record<RouterConfigFile, string> = {
  ip_exclude: '/opt/etc/xkeen/ip_exclude.lst',
  port_exclude: '/opt/etc/xkeen/port_exclude.lst',
  port_proxying: '/opt/etc/xkeen/port_proxying.lst',
  xkeen: '/opt/etc/xkeen/xkeen.json',
};

export async function getRouterConfigFile(file: RouterConfigFile, signal?: AbortSignal): Promise<{ path: string; content: string }> {
  const payload = await getMihomoJson(`/api/v1/config/files/${file}`, 'Чтение файла XKeen', signal);
  if (!isRecord(payload) || payload.file !== file || payload.path !== routerConfigPaths[file] || typeof payload.content !== 'string') {
    throw new Error('Backend вернул некорректный файл XKeen');
  }
  return { path: payload.path, content: payload.content };
}

const xrayConfigPaths: Record<XrayConfigFile, string> = {
  xray_outbounds: '/opt/etc/xray/configs/04_outbounds.json',
  xray_routing: '/opt/etc/xray/configs/05_routing.json',
};

export async function getXrayConfigFile(file: XrayConfigFile, signal?: AbortSignal): Promise<{ path: string; content: string }> {
  const payload = await getMihomoJson(`/api/v1/config/xray/${file}`, 'Чтение конфигурации Xray', signal);
  if (!isRecord(payload) || payload.file !== file || payload.path !== xrayConfigPaths[file] || typeof payload.content !== 'string') {
    throw new Error('Backend вернул некорректный файл Xray');
  }
  return { path: payload.path, content: payload.content };
}

export async function saveRouterConfigFile(file: RouterConfigFile, content: string, expectedContent: string): Promise<{ path: string; backup: string; detail: string }> {
  const response = await fetch(`/api/v1/config/files/${file}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedContent }),
  });
  const payload = await readJson(response, 'Сохранение файла XKeen');
  if (!isRecord(payload) || payload.status !== 'saved' || payload.path !== routerConfigPaths[file] ||
      typeof payload.backup !== 'string' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат сохранения файла XKeen');
  }
  return { path: payload.path, backup: payload.backup, detail: payload.detail };
}

export async function saveXrayConfigFile(file: XrayConfigFile, content: string, expectedContent: string): Promise<{ path: string; backup: string; detail: string }> {
  const response = await fetch(`/api/v1/config/xray/${file}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedContent }),
  });
  const payload = await readJson(response, 'Сохранение конфигурации Xray');
  if (!isRecord(payload) || payload.status !== 'saved' || payload.path !== xrayConfigPaths[file] ||
      typeof payload.backup !== 'string' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат сохранения конфигурации Xray');
  }
  return { path: payload.path, backup: payload.backup, detail: payload.detail };
}

export async function applyXrayConfigFile(file: XrayConfigFile, content: string, expectedContent: string, signal?: AbortSignal): Promise<ApplyMihomoConfigResult> {
  const response = await fetch(`/api/v1/config/xray/${file}/apply`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedContent }),
    signal,
  });
  const payload = await readJson(response, 'Применение конфигурации Xray');
  if (!isRecord(payload) || !['saved', 'applied'].includes(String(payload.status)) || payload.path !== xrayConfigPaths[file] ||
      typeof payload.backup !== 'string' || typeof payload.restarted !== 'boolean' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат применения конфигурации Xray');
  }
  return { status: payload.status as ApplyMihomoConfigResult['status'], path: payload.path, backup: payload.backup, restarted: payload.restarted, detail: payload.detail };
}

export interface ApplyMihomoConfigResult {
  status: 'saved' | 'applied';
  path: string;
  backup: string;
  restarted: boolean;
  detail: string;
}

export interface MihomoValidationResult {
  valid: true;
  detail: string;
}

export async function validateMihomoConfig(content: string, signal?: AbortSignal): Promise<MihomoValidationResult> {
  const response = await fetch('/api/v1/config/validate', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  });
  const payload = await readJson(response, 'Проверка конфигурации Mihomo');
  if (!isRecord(payload) || payload.valid !== true || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат проверки конфигурации Mihomo');
  }
  return { valid: true, detail: payload.detail };
}

export async function applyActiveMihomoConfig(content: string, expectedContent: string, signal?: AbortSignal): Promise<ApplyMihomoConfigResult> {
  const response = await fetch('/api/v1/config/active', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedContent }),
    signal,
  });
  const payload = await readJson(response, 'Применение конфигурации Mihomo');
  if (!isRecord(payload) || !['saved', 'applied'].includes(String(payload.status)) ||
      payload.path !== '/opt/etc/mihomo/config.yaml' || typeof payload.backup !== 'string' ||
      typeof payload.restarted !== 'boolean' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат применения конфигурации');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xkeen-config-applied'));
  return {
    status: payload.status as ApplyMihomoConfigResult['status'],
    path: payload.path,
    backup: payload.backup,
    restarted: payload.restarted,
    detail: payload.detail,
  };
}

export async function saveActiveMihomoConfig(content: string, expectedContent: string, signal?: AbortSignal): Promise<ApplyMihomoConfigResult> {
  const response = await fetch('/api/v1/config/active/save', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedContent }),
    signal,
  });
  const payload = await readJson(response, 'Сохранение конфигурации Mihomo');
  if (!isRecord(payload) || payload.status !== 'saved' || payload.path !== '/opt/etc/mihomo/config.yaml' ||
      typeof payload.backup !== 'string' || payload.restarted !== false || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат сохранения конфигурации Mihomo');
  }
  return { status: 'saved', path: payload.path, backup: payload.backup, restarted: false, detail: payload.detail };
}

export async function getMihomoVersion(signal?: AbortSignal): Promise<string> {
  const payload = await getMihomoJson('/api/v1/mihomo/version', 'Получение версии Mihomo', signal);
  if (!isRecord(payload) || typeof payload.version !== 'string' || !payload.version.trim()) {
    throw new Error('Mihomo вернул некорректную версию');
  }
  return payload.version.trim();
}

export async function getMihomoConnections(signal?: AbortSignal): Promise<MihomoConnections> {
  const payload = await getMihomoJson('/api/v1/mihomo/connections', 'Получение соединений', signal);
  if (!isRecord(payload) || !Array.isArray(payload.connections)) {
    throw new Error('Mihomo вернул некорректный список соединений');
  }
  const connections = payload.connections.flatMap((raw): MihomoConnection[] => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.metadata)) return [];
    const metadata = raw.metadata;
    const chains = Array.isArray(raw.chains) ? raw.chains.filter((item): item is string => typeof item === 'string') : [];
    return [{
      id: raw.id,
      host: readString(metadata.host),
      destination: joinAddress(metadata.destinationIP, metadata.destinationPort),
      destinationPort: /^\d+$/.test(String(metadata.destinationPort)) && Number(metadata.destinationPort) > 0 && Number(metadata.destinationPort) <= 65535 ? Number(metadata.destinationPort) : undefined,
      source: joinAddress(metadata.sourceIP, metadata.sourcePort),
      sourceIp: readString(metadata.sourceIP),
      network: readString(metadata.network),
      process: readString(metadata.process),
      chains,
      rule: readString(raw.rule),
      rulePayload: readString(raw.rulePayload),
      upload: readCounter(raw.upload),
      download: readCounter(raw.download),
      start: readString(raw.start),
    }];
  });
  return {
    uploadTotal: readCounter(payload.uploadTotal),
    downloadTotal: readCounter(payload.downloadTotal),
    connections,
  };
}

export async function queryMihomoDns(name: string, recordType: string, signal?: AbortSignal): Promise<MihomoDnsResult> {
  const query = new URLSearchParams({ name, type: recordType });
  const payload = await getMihomoJson(`/api/v1/mihomo/dns/query?${query.toString()}`, 'DNS-запрос Mihomo', signal);
  if (!isRecord(payload) || typeof payload.Status !== 'number' || !Number.isInteger(payload.Status)) {
    throw new Error('Mihomo вернул некорректный DNS-ответ');
  }
  const rcode: Record<number, string> = {
    0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN',
    4: 'NOTIMP', 5: 'REFUSED',
  };
  const answers = Array.isArray(payload.Answer) ? payload.Answer.flatMap((raw): MihomoDnsRecord[] => {
    if (!isRecord(raw) || (typeof raw.name !== 'string') || (typeof raw.data !== 'string')) return [];
    return [{
      name: raw.name,
      type: typeof raw.type === 'string' || typeof raw.type === 'number' ? String(raw.type) : '—',
      ttl: typeof raw.TTL === 'number' && Number.isSafeInteger(raw.TTL) && raw.TTL >= 0 ? raw.TTL : null,
      data: raw.data,
    }];
  }) : [];
  return { status: rcode[payload.Status] ?? `RCODE ${payload.Status}`, answers };
}

export async function selectMihomoProxy(group: string, name: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/v1/mihomo/proxies/select', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ group, name }),
    signal,
  });
  await readJson(response, 'Переключение селектора');
}

export async function closeMihomoConnection(id: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/v1/mihomo/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal,
  });
  await throwForError(response, 'Закрытие соединения');
}

export async function closeAllMihomoConnections(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/v1/mihomo/connections', {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal,
  });
  await throwForError(response, 'Закрытие соединений');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function joinAddress(host: unknown, port: unknown): string {
  const address = readString(host);
  const number = typeof port === 'number' || typeof port === 'string' ? String(port) : '';
  const withBrackets = address.includes(':') && !(address.startsWith('[') && address.endsWith(']'))
    ? `[${address}]` : address;
  return address && number ? `${withBrackets}:${number}` : address || number;
}

async function getMihomoJson(path: string, operation: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson(response, operation);
}

export async function getCoreSources(): Promise<CoreSources> {
  const payload = await getMihomoJson('/api/v1/settings/core-sources', 'Получение источников ядер');
  if (!isRecord(payload) || typeof payload.xray !== 'string' || typeof payload.mihomo !== 'string') {
    throw new Error('Backend вернул некорректные источники ядер');
  }
  return { xray: payload.xray, mihomo: payload.mihomo };
}

export async function saveCoreSources(sources: CoreSources): Promise<CoreSources> {
  const response = await fetch('/api/v1/settings/core-sources', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sources),
  });
  const payload = await readJson(response, 'Сохранение источников ядер');
  if (!isRecord(payload) || typeof payload.xray !== 'string' || typeof payload.mihomo !== 'string') {
    throw new Error('Backend вернул некорректные источники ядер после сохранения');
  }
  return { xray: payload.xray, mihomo: payload.mihomo };
}

export async function getUpdateProxies(): Promise<UpdateProxies> {
  const payload = await getMihomoJson('/api/v1/settings/update-proxies', 'Получение GitHub-прокси');
  if (!isRecord(payload) || !Array.isArray(payload.proxies) || !payload.proxies.every((item) => typeof item === 'string')) {
    throw new Error('Backend вернул некорректный список GitHub-прокси');
  }
  return { proxies: payload.proxies };
}

export async function saveUpdateProxies(value: UpdateProxies): Promise<UpdateProxies> {
  const response = await fetch('/api/v1/settings/update-proxies', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const payload = await readJson(response, 'Сохранение GitHub-прокси');
  if (!isRecord(payload) || !Array.isArray(payload.proxies) || !payload.proxies.every((item) => typeof item === 'string')) {
    throw new Error('Backend вернул некорректный список GitHub-прокси после сохранения');
  }
  return { proxies: payload.proxies };
}

export async function installCoreRelease(request: {
  core: 'xray' | 'mihomo';
  tag: string;
  asset: string;
  sha256: string;
  keepBackup: boolean;
}): Promise<CoreInstallResult> {
  const response = await fetch('/api/v1/cores/install', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await readJson(response, `Установка ${request.core}`);
  if (!isRecord(payload) || payload.core !== request.core || payload.tag !== request.tag ||
      (payload.backup !== null && typeof payload.backup !== 'string') ||
      typeof payload.restarted !== 'boolean' || typeof payload.detail !== 'string') {
    throw new Error('Backend вернул некорректный результат установки ядра');
  }
  return payload as unknown as CoreInstallResult;
}

export async function getSystemLog(file: string, signal?: AbortSignal): Promise<SystemLog> {
  const query = new URLSearchParams({ file });
  const payload = await getMihomoJson(`/api/v1/logs?${query.toString()}`, 'Чтение журнала', signal);
  if (!isRecord(payload) || typeof payload.file !== 'string' || !Array.isArray(payload.lines) ||
      !payload.lines.every((line) => typeof line === 'string') || typeof payload.truncated !== 'boolean') {
    throw new Error('Backend вернул некорректный формат журнала');
  }
  return { file: payload.file, lines: payload.lines as string[], truncated: payload.truncated };
}

export async function logUiError(source: 'yaml' | 'config' | 'ui', message: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/v1/logs/ui-error', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, message: message.slice(0, 512) }),
    signal,
  });
  if (!response.ok) throw new Error(`Запись ошибки в журнал: HTTP ${response.status}`);
}

export async function getHealth(signal?: AbortSignal): Promise<{ status: string }> {
  const response = await fetch('/health', { signal });
  const payload = await readJson(response, 'Проверка API');
  if (!isRecord(payload) || payload.status !== 'ok') {
    throw new Error('Проверка API: backend вернул некорректный ответ');
  }
  return { status: 'ok' };
}

export async function getXkeenStatus(signal?: AbortSignal): Promise<XkeenStatus> {
  const payload = await getJson('/api/v1/xkeen', 'Получение статуса XKeen', signal);
  if (!isRecord(payload) || typeof payload.installed !== 'boolean' ||
      (payload.running !== null && typeof payload.running !== 'boolean') ||
      (payload.version !== null && typeof payload.version !== 'string') ||
      (payload.core !== null && !['mihomo', 'xray'].includes(String(payload.core))) ||
      (payload.initPath !== null && typeof payload.initPath !== 'string') || typeof payload.detail !== 'string') {
    throw new Error('Получение статуса XKeen: backend вернул некорректный ответ');
  }
  return {
    installed: payload.installed,
    running: payload.running,
    version: payload.version,
    core: payload.core as XkeenStatus['core'],
    initPath: payload.initPath as string | null,
    detail: payload.detail,
  };
}

export async function controlXkeen(action: 'start' | 'stop' | 'restart', signal?: AbortSignal): Promise<XkeenStatus> {
  const response = await fetch('/api/v1/xkeen/control', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
    signal,
  });
  const payload = await readJson(response, `Команда XKeen ${action}`);
  if (!isRecord(payload) || typeof payload.installed !== 'boolean' || typeof payload.detail !== 'string') {
    throw new Error('Управление XKeen: backend вернул некорректный ответ');
  }
  return payload as unknown as XkeenStatus;
}

async function getJson(path: string, operation: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson(response, operation);
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseSystemStatus(value: unknown): SystemStatus {
  if (!isRecord(value)) throw new Error('Получение статуса: backend вернул некорректный объект');
  const { appVersion, mode, port, uptimeSeconds, platform, memory, loadAverage, cpuPercent, services, notice } = value;
  if (typeof appVersion !== 'string' || !['router', 'simulation'].includes(String(mode)) ||
      !isNonNegativeInteger(port) || port < 1 || port > 65535 || !isNonNegativeInteger(uptimeSeconds) ||
      typeof platform !== 'string' || typeof notice !== 'string' || !Array.isArray(services)) {
    throw new Error('Получение статуса: поля ответа не соответствуют API-контракту');
  }

  const parsedServices: ServiceStatus[] = services.map((service: unknown) => {
    if (!isRecord(service) || typeof service.name !== 'string' || typeof service.detail !== 'string' ||
        !['running', 'stopped', 'unavailable', 'unknown'].includes(String(service.state)) ||
        (service.version !== null && typeof service.version !== 'string')) {
      throw new Error('Получение статуса: получено некорректное состояние компонента');
    }
    return {
      name: service.name,
      state: service.state as ServiceStatus['state'],
      version: service.version,
      detail: service.detail,
    };
  });

  let parsedMemory: SystemStatus['memory'] = null;
  if (memory !== null) {
    if (!isRecord(memory) || !isNonNegativeInteger(memory.usedMb) ||
        !isNonNegativeInteger(memory.totalMb) || memory.usedMb > memory.totalMb) {
      throw new Error('Получение статуса: получены некорректные показатели памяти');
    }
    parsedMemory = { usedMb: memory.usedMb, totalMb: memory.totalMb };
  }
  if (loadAverage !== null && (typeof loadAverage !== 'number' || !Number.isFinite(loadAverage) || loadAverage < 0)) {
    throw new Error('Получение статуса: получено некорректное значение нагрузки');
  }
  if (cpuPercent !== undefined && cpuPercent !== null && (typeof cpuPercent !== 'number' || !Number.isFinite(cpuPercent) || cpuPercent < 0 || cpuPercent > 100)) {
    throw new Error('Получение статуса: получено некорректное значение CPU');
  }

  return {
    appVersion,
    mode: mode as SystemStatus['mode'],
    port,
    uptimeSeconds,
    platform,
    memory: parsedMemory,
    loadAverage,
    cpuPercent: cpuPercent ?? null,
    services: parsedServices,
    notice,
  };
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  await throwForError(response, operation);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${operation}: backend вернул не JSON; проверьте Rust backend и адрес API`);
  }
  return await response.json() as unknown;
}

async function throwForError(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  const status = `HTTP ${response.status}`;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  let detail: string | null = null;
  if (contentType.includes('application/json')) {
    try {
      const payload: unknown = await response.clone().json();
      if (isRecord(payload) && typeof payload.error === 'string') {
        detail = payload.error
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, 2048) || null;
      }
    } catch {
      // Keep the status and a stable fallback when the server's error body is malformed.
    }
  }
  const message = detail
    ? `${operation}: ${detail} (${status})`
    : `${operation}: ${status}; backend не вернул сообщение об ошибке`;
  throw new ApiError(message, response.status);
}
