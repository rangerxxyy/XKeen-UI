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
  services: ServiceStatus[];
  notice: string;
}

export interface CoreSources {
  xray: string;
  mihomo: string;
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
  alive: boolean | null;
  delay: number | null;
}

export interface MihomoSelector {
  name: string;
  current: string | null;
  options: MihomoProxyOption[];
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
  source: string;
  network: string;
  process: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: number;
  download: number;
  start: string;
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

const TOKEN_KEY = 'xkeen-ui:session-token';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function setAccessToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function hasAccessToken(): boolean {
  return sessionStorage.getItem(TOKEN_KEY) !== null;
}

export async function getStatus(signal?: AbortSignal): Promise<SystemStatus> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch('/api/v1/status', {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  return parseSystemStatus(await readJson(response, 'Получение статуса'));
}

export async function getMihomoSelectors(signal?: AbortSignal): Promise<MihomoSelector[]> {
  const payload = await getMihomoJson('/api/v1/mihomo/proxies', 'Получение селекторов', signal);
  if (!isRecord(payload) || !isRecord(payload.proxies)) {
    throw new Error('Mihomo вернул некорректный список прокси');
  }
  const proxies = payload.proxies;
  return Object.entries(proxies).flatMap(([key, raw]): MihomoSelector[] => {
    if (!isRecord(raw) || raw.type !== 'Selector' || !Array.isArray(raw.all)) return [];
    const options = raw.all.flatMap((name): MihomoProxyOption[] => {
      if (typeof name !== 'string') return [];
      const option = proxies[name];
      const history = isRecord(option) && Array.isArray(option.history) ? option.history : [];
      const latest = history.at(-1);
      const delay = isRecord(latest) && typeof latest.delay === 'number' && Number.isFinite(latest.delay)
        ? latest.delay : null;
      return [{
        name,
        type: isRecord(option) && typeof option.type === 'string' ? option.type : 'Unknown',
        alive: isRecord(option) && typeof option.alive === 'boolean' ? option.alive : null,
        delay,
      }];
    });
    return [{ name: typeof raw.name === 'string' ? raw.name : key, current: typeof raw.now === 'string' ? raw.now : null, options }];
  });
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
      source: joinAddress(metadata.sourceIP, metadata.sourcePort),
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
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch('/api/v1/mihomo/proxies/select', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ group, name }),
    signal,
  });
  await readJson(response, 'Переключение селектора');
}

export async function closeMihomoConnection(id: string, signal?: AbortSignal): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/api/v1/mihomo/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  requireSuccess(response, 'Закрытие соединения');
}

export async function closeAllMihomoConnections(signal?: AbortSignal): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch('/api/v1/mihomo/connections', {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  requireSuccess(response, 'Закрытие соединений');
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
  return address && number ? `${address}:${number}` : address || number;
}

async function getMihomoJson(path: string, operation: string, signal?: AbortSignal): Promise<unknown> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch('/api/v1/settings/core-sources', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(sources),
  });
  const payload = await readJson(response, 'Сохранение источников ядер');
  if (!isRecord(payload) || typeof payload.xray !== 'string' || typeof payload.mihomo !== 'string') {
    throw new Error('Backend вернул некорректные источники ядер после сохранения');
  }
  return { xray: payload.xray, mihomo: payload.mihomo };
}

export async function getHealth(signal?: AbortSignal): Promise<{ status: string }> {
  const response = await fetch('/health', { signal });
  const payload = await readJson(response, 'Проверка API');
  if (!isRecord(payload) || payload.status !== 'ok') {
    throw new Error('Проверка API: backend вернул некорректный ответ');
  }
  return { status: 'ok' };
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
  const { appVersion, mode, port, uptimeSeconds, platform, memory, loadAverage, services, notice } = value;
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

  return {
    appVersion,
    mode: mode as SystemStatus['mode'],
    port,
    uptimeSeconds,
    platform,
    memory: parsedMemory,
    loadAverage,
    services: parsedServices,
    notice,
  };
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  requireSuccess(response, operation);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${operation}: backend вернул не JSON; проверьте Rust backend и адрес API`);
  }
  return await response.json() as unknown;
}

function requireSuccess(response: Response, operation: string): void {
  if (!response.ok) throw new ApiError(`${operation}: HTTP ${response.status}`, response.status);
}
