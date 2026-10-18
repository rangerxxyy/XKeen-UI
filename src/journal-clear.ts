const STORAGE_KEY = 'xkeen-ui.journal-clear.v1';

export interface JournalClearStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ClearState = Record<string, Record<string, number>>;

function browserStorage(): JournalClearStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readState(storage: JournalClearStorage): ClearState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as ClearState;
  } catch {
    return {};
  }
}

function writeState(storage: JournalClearStorage, state: ClearState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Clearing remains available for the current view if browser storage is unavailable.
  }
}

export function rememberClearedJournal(file: string, lines: string[], storage = browserStorage()): void {
  if (!storage) return;
  const state = readState(storage);
  const counts = state[file] ?? {};
  for (const line of lines) counts[line] = (counts[line] ?? 0) + 1;
  state[file] = counts;
  writeState(storage, state);
}

export function hideClearedJournalLines(file: string, lines: string[], storage = browserStorage()): string[] {
  if (!storage) return lines;
  const counts = { ...(readState(storage)[file] ?? {}) };
  return lines.filter((line) => {
    const remaining = counts[line] ?? 0;
    if (remaining <= 0) return true;
    if (remaining === 1) delete counts[line];
    else counts[line] = remaining - 1;
    return false;
  });
}
