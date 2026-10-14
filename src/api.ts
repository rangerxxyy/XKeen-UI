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

export interface ApiState {
  connected: boolean;
  status: SystemStatus | null;
  error: string | null;
  checkedAt: Date | null;
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
  if (!response.ok) throw new ApiError(`${operation}: HTTP ${response.status}`, response.status);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${operation}: backend вернул не JSON; проверьте Rust backend и адрес API`);
  }
  return await response.json() as unknown;
}
