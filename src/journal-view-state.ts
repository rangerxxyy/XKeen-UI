export type JournalViewState = 'loading' | 'error' | 'cleared' | 'data' | 'empty';
export type JournalMessageSegment = { text: string; tone?: 'stopped' | 'started' | 'mode' };

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
  return [{ text: message }];
}

export function renderJournalLoadingSkeleton(): string {
  const row = (index: number) => `<div class="journal-skeleton-row"><span class="skeleton-block is-time"></span><span class="skeleton-block is-level"></span><span class="skeleton-block is-message message-${index % 3}"></span></div>`;
  return `<div class="journal-skeleton" role="status" aria-label="Загружаем журнал" aria-busy="true">${Array.from({ length: 6 }, (_, index) => row(index)).join('')}</div>`;
}

export function deduplicateRepeatedUiErrors(lines: string[]): string[] {
  const seenPollErrors = new Set<string>();
  return lines.filter((line) => {
    if (!/component=xkeen-ui\s+source=ui\s+message=Данные не обновились:/i.test(line)) return true;
    if (seenPollErrors.has(line)) return false;
    seenPollErrors.add(line);
    return true;
  });
}

export function stripLogSourceLabel(line: string): string {
  return line.replace(/\s+\[(?:XKeen|Xray|XKeen UI)\]\s*$/, '');
}

export function splitJournalLevel(message: string, sourceLine = message): { level: string | null; message: string } {
  const prefix = message.match(/^(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\s+/i);
  if (prefix) return { level: (prefix[1] ?? '').toUpperCase(), message: message.slice(prefix[0].length) };
  const metadata = sourceLine.match(/\blevel=(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b/i);
  return { level: metadata?.[1]?.toUpperCase() ?? null, message };
}

export function formatJournalTimestamp(line: string, timeZone: string): { timestamp: string; message: string } | null {
  const xkeen = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)\s+(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+([\s\S]*)$/i);
  if (xkeen) {
    const rawTimestamp = xkeen[1] ?? '';
    const date = new Date(rawTimestamp.replace(/\//g, '-').replace(' ', 'T'));
    if (!Number.isFinite(date.getTime())) return null;
    const fraction = rawTimestamp.match(/\.(\d{1,9})$/)?.[1] ?? '';
    return {
      timestamp: formatPreciseTimestamp(date, timeZone, fraction),
      message: `${(xkeen[2] ?? 'INFO').toUpperCase()} ${xkeen[3] ?? ''}`,
    };
  }
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
  const unixMatch = line.match(/^unix=(\d{10})(?:\s+level=(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL))?\s+([\s\S]*)$/i);
  if (unixMatch) {
    const rawTimestamp = unixMatch[1] ?? '';
    const date = new Date(Number(rawTimestamp) * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    const rawMessage = unixMatch[3] ?? '';
    // Router-owned UI entries use key/value metadata; show their message while
    // keeping the severity in its own badge instead of leaking logger fields.
    const message = rawMessage.match(/(?:^|\s)(?:message|msg)=([\s\S]*)$/)?.[1] ?? rawMessage;
    const level = unixMatch[2]?.toUpperCase();
    const timestamp = formatReadableTimestamp(date, timeZone);
    return timestamp ? { timestamp, message: [level, message].filter(Boolean).join(' ') } : null;
  }
  const match = line.match(/^\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))\]?\s+(.*)$/);
  if (!match) return null;
  const date = new Date(match[1] ?? '');
  if (!Number.isFinite(date.getTime())) return null;
  const timestamp = formatReadableTimestamp(date, timeZone);
  return timestamp ? { timestamp, message: match[2] ?? '' } : null;
}

function formatReadableTimestamp(date: Date, timeZone: string): string | null {
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
    return new Intl.DateTimeFormat('ru-RU', options).format(formattedDate);
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
