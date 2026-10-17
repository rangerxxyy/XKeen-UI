export type JournalViewState = 'loading' | 'error' | 'cleared' | 'data' | 'empty';
export type JournalMessageSegment = { text: string; tone?: 'stopped' | 'started' | 'mode' | 'info' | 'warning' | 'error' };

export function stripLogSourceLabel(line: string): string {
  return line.replace(/\s+\[(?:XKeen|Xray|XKeen UI)\]\s*$/, '');
}

export function formatJournalMessage(message: string): JournalMessageSegment[] {
  const stopped = message.match(/^(\s*Прокси-клиент\s+)(остановлен)(.*)$/i);
  if (stopped) return [
    { text: stopped[1] ?? '' },
    { text: stopped[2] ?? '', tone: 'stopped' },
    { text: stopped[3] ?? '' },
  ];
  const started = message.match(/^(\s*Прокси-клиент\s+)(запущен)(\s+в режиме\s+)(.+)$/i);
  if (started) return [
    { text: started[1] ?? '' },
    { text: started[2] ?? '', tone: 'started' },
    { text: started[3] ?? '' },
    { text: started[4] ?? '', tone: 'mode' },
  ];
  const severity = message.match(/^\[?(INFO|WARN|WARNING|ERROR|FATAL)\]?\s+(.*)$/i);
  if (severity) {
    const level = (severity[1] ?? '').toUpperCase();
    const tone = level === 'INFO' ? 'info' : level === 'WARN' || level === 'WARNING' ? 'warning' : 'error';
    return [
      { text: level, tone },
      { text: ` ${severity[2] ?? ''}` },
    ];
  }
  return [{ text: message }];
}

export function formatJournalTimestamp(line: string, timeZone: string): { timestamp: string; message: string } | null {
  const xray = line.match(/^time="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))"\s+level=(\w+)\s+msg="([\s\S]*)"(?:\s+\[Xray\])?$/);
  if (xray) {
    const rawTimestamp = xray[1] ?? '';
    const level = xray[2] ?? 'INFO';
    const rawMessage = xray[3] ?? '';
    const date = new Date(rawTimestamp);
    if (!Number.isFinite(date.getTime())) return null;
    const fraction = rawTimestamp.match(/\.(\d{1,9})(?=Z|[+-]\d{2}:\d{2}$)/)?.[1] ?? '';
    const timestamp = formatPreciseTimestamp(date, timeZone, fraction);
    const message = rawMessage.replace(/\\"/g, '"').replace(/\\n/g, ' ');
    return { timestamp, message: `${level.toUpperCase()} ${message}` };
  }
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

function formatPreciseTimestamp(date: Date, timeZone: string, fraction: string): string {
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
  let adjustedDate = date;
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  };
  if (hours !== undefined) {
    adjustedDate = new Date(date.getTime() + hours * 60 * 60 * 1000);
    options.timeZone = 'UTC';
  } else if (timeZone && timeZone !== 'local' && timeZone !== 'system') {
    options.timeZone = timeZone;
  }
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(adjustedDate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const precise = fraction ? `.${fraction.slice(0, 6).padEnd(6, '0')}` : '';
  return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}:${values.second}${precise}`;
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
