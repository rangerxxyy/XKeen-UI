// @ts-expect-error Vitest provides Node's fs runtime; the frontend project intentionally omits @types/node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deduplicateRepeatedUiErrors, formatJournalMessage, formatJournalTimestamp, getJournalViewState, renderJournalLoadingSkeleton, splitJournalLevel, stripLogSourceLabel } from './journal-view-state';

describe('renderJournalLoadingSkeleton', () => {
  it('renders reserved journal rows rather than a centered spinner on first load', () => {
    const html = renderJournalLoadingSkeleton();
    expect(html).toContain('class="journal-skeleton"');
    expect(html).toContain('class="journal-skeleton-row"');
    expect(html).not.toContain('loading-orbit');
  });
});

describe('getJournalViewState', () => {
  it('keeps existing journal rows visible while refreshing in the background', () => {
    expect(getJournalViewState({ loading: true, hasData: true, error: null, cleared: false })).toBe('data');
  });

  it('shows a loading state on the first journal request', () => {
    expect(getJournalViewState({ loading: true, hasData: false, error: null, cleared: false })).toBe('loading');
  });

  it('keeps the existing error visible while retrying a failed journal request', () => {
    expect(getJournalViewState({ loading: true, hasData: false, error: 'Backend недоступен', cleared: false })).toBe('error');
  });

  it('keeps an explicit cleared state while a refresh is running', () => {
    expect(getJournalViewState({ loading: true, hasData: true, error: null, cleared: true })).toBe('cleared');
  });
});

describe('formatJournalTimestamp', () => {
  it('formats ISO timestamps with the selected timezone and keeps the message', () => {
    expect(formatJournalTimestamp('2026-10-16T17:30:00Z Started', 'Europe/Moscow'))
      .toEqual({ timestamp: '16.10.2026, 20:30:00', message: 'Started' });
  });

  it('formats Xray runtime records like the router journal reference', () => {
    expect(formatJournalTimestamp(
      'time="2026-10-17T11:37:51.016495416Z" level=info msg="Start initial configuration in progress"',
      'Europe/Moscow',
    )).toEqual({ timestamp: '2026/10/17 14:37:51.016495', message: 'INFO Start initial configuration in progress' });
  });

  it('formats XKeen slash timestamps and separates their severity from the message', () => {
    expect(formatJournalTimestamp(
      '2026/10/18 10:09:03.164232 INFO Start initial configuration in progress',
      'local',
    )).toEqual({ timestamp: '2026/10/18 10:09:03.164232', message: 'INFO Start initial configuration in progress' });
  });

  it('formats the Unix timestamps written by the router lifecycle and UI error logger', () => {
    const timestamp = Math.floor(Date.parse('2026-10-16T17:30:00Z') / 1000);
    expect(formatJournalTimestamp(`unix=${timestamp} level=ERROR component=xkeen-ui source=yaml message=Invalid YAML`, 'Europe/Moscow'))
      .toEqual({ timestamp: '16.10.2026, 20:30:00', message: 'ERROR Invalid YAML' });
  });

  it('keeps meaningful lifecycle text while hiding internal event metadata', () => {
    expect(formatJournalTimestamp(
      'unix=1792319887 level=ERROR component=xkeen action=restart running_before=true running_after=false message=Не удалось перезапустить службу',
      'UTC',
    )).toEqual({ timestamp: '18.10.2026, 10:38:07', message: 'ERROR Не удалось перезапустить службу' });
  });

  it('leaves lines without an explicit ISO timestamp unchanged', () => {
    expect(formatJournalTimestamp('INFO service started', 'UTC')).toBeNull();
  });
});

describe('stripLogSourceLabel', () => {
  it('keeps source tags out of the user-visible log line', () => {
    expect(stripLogSourceLabel('Прокси-клиент остановлен  [Xray]')).toBe('Прокси-клиент остановлен');
    expect(stripLogSourceLabel('Ошибка YAML  [XKeen UI]')).toBe('Ошибка YAML');
    expect(stripLogSourceLabel('rule-set:category-ru@domain')).toBe('rule-set:category-ru@domain');
  });
});

describe('deduplicateRepeatedUiErrors', () => {
  it('keeps the first copy of identical UI polling errors but preserves other repeated entries', () => {
    const pollError = 'unix=1792319887 level=ERROR component=xkeen-ui source=ui message=Данные не обновились: Mihomo вернул некорректный список соединений  [XKeen UI]';
    const serviceError = 'unix=1792319887 level=ERROR component=xkeen-ui source=config message=Ошибка YAML  [XKeen UI]';

    expect(deduplicateRepeatedUiErrors([pollError, pollError, pollError, serviceError, serviceError]))
      .toEqual([pollError, serviceError, serviceError]);
  });
});

describe('splitJournalLevel', () => {
  it('separates XKeen severity labels from their message text', () => {
    expect(splitJournalLevel('INFO Start initial configuration in progress'))
      .toEqual({ level: 'INFO', message: 'Start initial configuration in progress' });
  });

  it('reads severity from panel lifecycle metadata when the message has no level prefix', () => {
    expect(splitJournalLevel('component=xkeen action=restart', 'unix=42 level=ERROR component=xkeen action=restart'))
      .toEqual({ level: 'ERROR', message: 'component=xkeen action=restart' });
  });
});

describe('formatJournalMessage', () => {
  it('marks service start, stop, and Hybrid mode while preserving surrounding text', () => {
    expect(formatJournalMessage('Прокси-клиент остановлен')).toEqual([
      { text: 'Прокси-клиент ' }, { text: 'остановлен', tone: 'stopped' }, { text: '' },
    ]);
    expect(formatJournalMessage('Прокси-клиент запущен в режиме Hybrid')).toEqual([
      { text: 'Прокси-клиент ' }, { text: 'запущен', tone: 'started' },
      { text: ' в режиме ' }, { text: 'Hybrid', tone: 'mode' },
    ]);
  });

  it('leaves unrelated messages as plain text', () => {
    expect(formatJournalMessage('configuration loaded')).toEqual([{ text: 'configuration loaded' }]);
  });

  it('styles the lifecycle tone classes emitted for service state messages', () => {
    const styles = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.journal-message-stopped\s*\{[^}]*color\s*:/);
    expect(styles).toMatch(/\.journal-message-started\s*\{[^}]*color\s*:/);
    expect(styles).toMatch(/\.journal-message-mode\s*\{[^}]*color\s*:/);
  });
});
