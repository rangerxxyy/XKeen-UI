export interface DeviceListPayload {
  host?: Array<{ name?: unknown; hostname?: unknown; ip?: unknown; ip6?: unknown }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDeviceNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!isRecord(value) || !Array.isArray(value.host)) return names;
  for (const raw of value.host) {
    if (!isRecord(raw)) continue;
    const name = (typeof raw.name === 'string' ? raw.name.trim() : '')
      || (typeof raw.hostname === 'string' ? raw.hostname.trim() : '');
    if (!name) continue;
    const ips = [raw.ip, ...(Array.isArray(raw.ip6) ? raw.ip6 : [])];
    for (const rawIp of ips) {
      if (typeof rawIp !== 'string') continue;
      const ip = rawIp.trim();
      if (ip && ip !== '0.0.0.0' && ip !== '::') names.set(ip, name);
    }
  }
  return names;
}

export class SourceNameResolver {
  private readonly cache = new Map<string, { name: string | null; retryAt: number }>();
  private pending: Promise<void> | null = null;

  constructor(
    private readonly fetchNames: () => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(sourceIps: string[]): Promise<Record<string, string>> {
    const now = this.now();
    const ips = [...new Set(sourceIps.map((ip) => ip.trim()).filter((ip) => ip && ip !== '0.0.0.0' && ip !== '::'))];
    let missing = ips.filter((ip) => {
      const cached = this.cache.get(ip);
      return !cached || (!cached.name && cached.retryAt <= now);
    });
    if (missing.length && this.pending) await this.pending;
    missing = ips.filter((ip) => {
      const cached = this.cache.get(ip);
      return !cached || (!cached.name && cached.retryAt <= this.now());
    });
    if (missing.length && !this.pending) {
      this.pending = this.refresh(missing).finally(() => { this.pending = null; });
      await this.pending;
    }
    const result: Record<string, string> = {};
    for (const ip of ips) {
      const name = this.cache.get(ip)?.name;
      if (name) result[ip] = name;
    }
    return result;
  }

  private async refresh(requested: string[]): Promise<void> {
    const retryAt = this.now() + 3000;
    try {
      const names = parseDeviceNames(await this.fetchNames());
      for (const [ip, name] of names) this.cache.set(ip, { name, retryAt: 0 });
      for (const ip of requested) if (!names.has(ip)) this.cache.set(ip, { name: null, retryAt });
    } catch {
      for (const ip of requested) this.cache.set(ip, { name: null, retryAt });
    }
    while (this.cache.size > 1000) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
