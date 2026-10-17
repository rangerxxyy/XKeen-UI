export type SelectorSort = 'config' | 'name' | 'delay';
export type UiTheme = 'system' | 'light' | 'dark';
export type JournalTimeZone = 'local' | `UTC${'+' | '-'}${number}`;

export interface UiPreferences {
  theme: UiTheme;
  journalTimeZone: JournalTimeZone;
  showConnectionSource: boolean;
  closeConnectionsAfterApply: boolean;
  dnsAutostart: 'off' | 'confirm';
  hideUnavailableProxies: boolean;
  unavailableThreshold: number;
  selectorSort: SelectorSort;
  pingScheme: 'https' | 'http';
  pingUrl: string;
  pingTimeoutMs: number;
  autoCheckPanel: boolean;
  autoCheckCore: boolean;
  keepCoreBackup: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  theme: 'system',
  journalTimeZone: 'local',
  showConnectionSource: true,
  closeConnectionsAfterApply: false,
  dnsAutostart: 'off',
  hideUnavailableProxies: false,
  unavailableThreshold: 3,
  selectorSort: 'config',
  pingScheme: 'https',
  pingUrl: 'www.gstatic.com/generate_204',
  pingTimeoutMs: 5000,
  autoCheckPanel: true,
  autoCheckCore: true,
  keepCoreBackup: true,
};

const STORAGE_KEY = 'xkeen-ui:preferences:v1';

export function readUiPreferences(storage: Pick<Storage, 'getItem'> | null = safeStorage()): UiPreferences {
  if (!storage) return { ...DEFAULT_UI_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_UI_PREFERENCES };
    const value = parsed as Partial<UiPreferences>;
    return {
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system',
      journalTimeZone: normalizeJournalTimeZone(value.journalTimeZone),
      showConnectionSource: typeof value.showConnectionSource === 'boolean' ? value.showConnectionSource : DEFAULT_UI_PREFERENCES.showConnectionSource,
      closeConnectionsAfterApply: typeof value.closeConnectionsAfterApply === 'boolean' ? value.closeConnectionsAfterApply : DEFAULT_UI_PREFERENCES.closeConnectionsAfterApply,
      dnsAutostart: value.dnsAutostart === 'confirm' ? 'confirm' : 'off',
      hideUnavailableProxies: typeof value.hideUnavailableProxies === 'boolean' ? value.hideUnavailableProxies : DEFAULT_UI_PREFERENCES.hideUnavailableProxies,
      unavailableThreshold: validInteger(value.unavailableThreshold, 1, 10, DEFAULT_UI_PREFERENCES.unavailableThreshold),
      selectorSort: value.selectorSort === 'name' || value.selectorSort === 'delay' ? value.selectorSort : 'config',
      pingScheme: value.pingScheme === 'http' ? 'http' : 'https',
      pingUrl: validPingUrl(value.pingUrl) ? value.pingUrl : DEFAULT_UI_PREFERENCES.pingUrl,
      pingTimeoutMs: validInteger(value.pingTimeoutMs, 500, 30000, DEFAULT_UI_PREFERENCES.pingTimeoutMs),
      autoCheckPanel: typeof value.autoCheckPanel === 'boolean' ? value.autoCheckPanel : DEFAULT_UI_PREFERENCES.autoCheckPanel,
      autoCheckCore: typeof value.autoCheckCore === 'boolean' ? value.autoCheckCore : DEFAULT_UI_PREFERENCES.autoCheckCore,
      keepCoreBackup: typeof value.keepCoreBackup === 'boolean' ? value.keepCoreBackup : DEFAULT_UI_PREFERENCES.keepCoreBackup,
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

function normalizeJournalTimeZone(value: unknown): JournalTimeZone {
  if (value === 'local') return value;
  if (typeof value === 'string') {
    const match = value.match(/^UTC([+-])(\d{1,2})$/);
    if (match) {
      const offset = Number(match[2]) * (match[1] === '-' ? -1 : 1);
      if (offset >= -12 && offset <= 14) return `UTC${offset >= 0 ? '+' : ''}${offset}` as JournalTimeZone;
    }
    const legacyOffsets: Record<string, JournalTimeZone> = {
      UTC: 'UTC+0',
      'Europe/Kaliningrad': 'UTC+2',
      'Europe/Moscow': 'UTC+3',
      'Asia/Yekaterinburg': 'UTC+5',
      'Asia/Novosibirsk': 'UTC+7',
      'Asia/Vladivostok': 'UTC+10',
    };
    if (legacyOffsets[value]) return legacyOffsets[value]!;
  }
  return DEFAULT_UI_PREFERENCES.journalTimeZone;
}

export function writeUiPreferences(preferences: UiPreferences, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Private browsing or a full storage quota should not prevent using the panel.
  }
}

export function validPingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 253 || !value.trim() || /[\s?#@]/.test(value) || value.startsWith('/') || value.endsWith('/')) return false;
  const [host, ...path] = value.split('/');
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) || host.startsWith('.') || host.endsWith('.')) return false;
  return path.every((part) => /^[a-z0-9._~-]{1,80}$/i.test(part) && part !== '.' && part !== '..');
}

function validInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
