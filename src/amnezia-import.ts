import { stringify } from 'yaml';

export type AmneziaVersion = '1.0' | '1.5' | '2.0' | '3.0' | '3.1';
export interface DetectedAmneziaVersion { version: AmneziaVersion; confidence: 'exact' | 'minimum' }

export function renderAmneziaImportActionMarkup(): string {
  return '<button class="editor-button editor-button-primary" type="button" data-amnezia-add>Добавить в конфигурацию</button>';
}

type Section = Record<string, string>;

function hasAny(values: Section, keys: string[]): boolean {
  return keys.some((key) => values[key] != null && values[key] !== '');
}

function detectVersion(iface: Section): DetectedAmneziaVersion {
  const explicit = iface.Version?.trim();
  if (explicit) {
    const normalized: Record<string, AmneziaVersion> = { '1': '1.0', '1.0': '1.0', '1.5': '1.5', '2': '2.0', '2.0': '2.0', '3': '3.0', '3.0': '3.0', '3.1': '3.1' };
    const version = normalized[explicit];
    if (!version) throw new Error(`Неподдерживаемая версия AmneziaWG: ${explicit}`);
    return { version, confidence: 'exact' };
  }
  if (hasAny(iface, ['RandomTrailers', 'DisableCookies'])) return { version: '3.1', confidence: 'minimum' };
  if (hasAny(iface, ['HeaderProtectionKey', 'ContentPaddingAddition', 'RekeyAfterTime', 'RekeyTimeout', 'RejectAfterTime', 'KeepaliveTimeout', 'MaxHandshakeAttempts'])) return { version: '3.0', confidence: 'minimum' };
  if (hasAny(iface, ['J1', 'J2', 'J3', 'Itime'])) return { version: '1.5', confidence: 'minimum' };
  if (hasAny(iface, ['S3', 'S4', 'I1', 'I2', 'I3', 'I4', 'I5'])) return { version: '2.0', confidence: 'minimum' };
  if (hasAny(iface, ['Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'H1', 'H2', 'H3', 'H4'])) return { version: '1.0', confidence: 'minimum' };
  throw new Error('Не удалось определить версию AmneziaWG: параметры AWG не найдены');
}

function parseSections(content: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let current = '';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      current = section[1]?.trim() ?? '';
      if (!current) continue;
      if (!sections.has(current)) sections.set(current, {});
      continue;
    }
    const equals = line.indexOf('=');
    if (!current || equals < 0) continue;
    sections.get(current)![line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return sections;
}

function list(value?: string): string[] {
  return value?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
}

function number(value: string | undefined, fallback?: number): number | undefined {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Некорректное числовое значение: ${value}`);
  return parsed;
}

function keepalive(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const exact = Number(value);
  if (Number.isInteger(exact) && exact >= 0) return exact;
  const range = value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!range) throw new Error(`Некорректное числовое значение: ${value}`);
  const min = Number(range[1]);
  const max = Number(range[2]);
  if (max < min) throw new Error(`Некорректный диапазон: ${value}`);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function endpoint(value: string): { server: string; port: number } {
  const trimmed = value.trim();
  const ipv6 = trimmed.match(/^\[([^\]]+)]:(\d+)$/);
  const split: [string | undefined, string | undefined] = ipv6 ? [ipv6[1], ipv6[2]] : [trimmed.slice(0, trimmed.lastIndexOf(':')), trimmed.slice(trimmed.lastIndexOf(':') + 1)];
  const port = Number(split[1]);
  if (!split[0] || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Некорректный Endpoint: ${value}`);
  return { server: split[0], port };
}

const optionKeys: Record<string, string> = {
  Jc: 'jc', Jmin: 'jmin', Jmax: 'jmax', S1: 's1', S2: 's2', S3: 's3', S4: 's4',
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', I1: 'i1', I2: 'i2', I3: 'i3', I4: 'i4', I5: 'i5',
  J1: 'j1', J2: 'j2', J3: 'j3', Itime: 'itime',
  HeaderProtectionKey: 'header-protection-key', ContentPaddingAddition: 'content-padding-addition',
  RekeyAfterTime: 'rekey-after-time', RekeyTimeout: 'rekey-timeout', RejectAfterTime: 'reject-after-time',
  KeepaliveTimeout: 'keepalive-timeout', MaxHandshakeAttempts: 'max-handshake-attempts',
  RandomTrailers: 'random-trailers', DisableCookies: 'disable-cookies',
};

function amneziaOptions(iface: Section, detected: DetectedAmneziaVersion): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = { version: detected.version === '3.0' || detected.version === '3.1' ? 3 : 2 };
  for (const [source, target] of Object.entries(optionKeys)) {
    const raw = iface[source];
    if (!raw) continue;
    if (source === 'RandomTrailers' || source === 'DisableCookies') output[target] = ['true', 'on', '1'].includes(raw.toLowerCase());
    else if (['Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'S3', 'S4', 'Itime'].includes(source)) output[target] = number(raw)!;
    else output[target] = raw;
  }
  return output;
}

export function convertAmneziaConfig(content: string, fileName: string): { yaml: string; previewYaml: string; version: DetectedAmneziaVersion } {
  const sections = parseSections(content);
  const iface = sections.get('Interface');
  if (!iface) throw new Error('Секция [Interface] не найдена');
  const address = list(iface.Address);
  if (!address.length) throw new Error('В [Interface] отсутствует Address');
  if (!iface.PrivateKey) throw new Error('В [Interface] отсутствует PrivateKey');
  const peers = [...sections.entries()].filter(([name]) => /^Peer(?:\s+\d+)?$/i.test(name)).map(([, peer]) => peer);
  if (!peers.length) throw new Error('Секция [Peer] не найдена');
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'amnezia';
  for (const [index, peer] of peers.entries()) {
    if (!peer.Endpoint) throw new Error(`[Peer ${index + 1}] отсутствует Endpoint`);
    if (!peer.PublicKey) throw new Error(`[Peer ${index + 1}] отсутствует PublicKey`);
  }
  const version = detectVersion(iface);
  const proxies = peers.map((peer, index) => {
    const server = endpoint(peer.Endpoint!);
    const proxy: Record<string, unknown> = {
      name: peers.length === 1 ? baseName : `${baseName}_${index + 1}`,
      type: 'wireguard', server: server.server, port: server.port, ip: address[0],
      'private-key': iface.PrivateKey, 'public-key': peer.PublicKey, udp: true,
      mtu: number(iface.MTU, 1280),
    };
    const dns = list(iface.DNS);
    const allowed = list(peer.AllowedIPs);
    if (dns.length) proxy.dns = dns;
    if (allowed.length) proxy['allowed-ips'] = allowed;
    if (peer.PresharedKey) proxy['pre-shared-key'] = peer.PresharedKey;
    const ping = keepalive(peer.PersistentKeepalive);
    if (ping != null) proxy['persistent-keepalive'] = ping;
    proxy['amnezia-wg-option'] = amneziaOptions(iface, version);
    return proxy;
  });
  const yaml = stringify(proxies, { lineWidth: 0, aliasDuplicateObjects: false });
  const preview = proxies.map((proxy) => ({
    ...proxy,
    'private-key': '••••••••',
    'public-key': '••••••••',
    ...(proxy['pre-shared-key'] ? { 'pre-shared-key': '••••••••' } : {}),
  }));
  return { yaml, previewYaml: stringify(preview, { lineWidth: 0, aliasDuplicateObjects: false }), version };
}
