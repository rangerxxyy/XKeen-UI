export type JournalViewState = 'loading' | 'error' | 'cleared' | 'data' | 'empty';

export function formatJournalTimestamp(line: string, timeZone: string): { timestamp: string; message: string } | null {
  const match = line.match(/^\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))\]?\s+(.*)$/);
  if (!match) return null;
  const date = new Date(match[1] ?? '');
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' };
    if (timeZone !== 'local') options.timeZone = timeZone;
    return { timestamp: new Intl.DateTimeFormat('ru-RU', options).format(date), message: match[2] ?? '' };
  } catch {
    return null;
  }
}

export function getJournalViewState(input: {
  loading: boolean;
  hasData: boolean;
  error: string | null;
  cleared: boolean;
}): JournalViewState {
  if (input.cleared) return 'cleared';
  if (input.hasData) return 'data';
  if (input.error) return 'error';
  if (input.loading) return 'loading';
  return 'empty';
}
