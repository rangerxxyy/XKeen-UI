export type JournalViewState = 'loading' | 'error' | 'cleared' | 'data' | 'empty';

export function formatJournalTimestamp(line: string, timeZone: string): { timestamp: string; message: string } | null {
  const match = line.match(/^\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))\]?\s+(.*)$/)
    ?? line.match(/^unix=(\d{10})(?:\s+level=\w+)?\s+(.*)$/);
  if (!match) return null;
  const rawTimestamp = match[1] ?? '';
  const date = rawTimestamp.length === 10 && /^\d{10}$/.test(rawTimestamp)
    ? new Date(Number(rawTimestamp) * 1000)
    : new Date(rawTimestamp);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' };
    let formattedDate = date;
    const legacyOffsets: Record<string, number> = {
      UTC: 0,
      'Europe/Kaliningrad': 2,
      'Europe/Moscow': 3,
      'Asia/Yekaterinburg': 5,
      'Asia/Novosibirsk': 7,
      'Asia/Vladivostok': 10,
    };
    const offset = timeZone.match(/^UTC([+-]\d{1,2})$/);
    const hours = offset ? Number(offset[1]) : legacyOffsets[timeZone];
    if (hours !== undefined) {
      formattedDate = new Date(date.getTime() + hours * 60 * 60 * 1000);
      options.timeZone = 'UTC';
    }
    return { timestamp: new Intl.DateTimeFormat('ru-RU', options).format(formattedDate), message: match[2] ?? '' };
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
