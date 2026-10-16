import { describe, expect, it } from 'vitest';
import { formatJournalTimestamp, getJournalViewState } from './journal-view-state';

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

  it('formats the Unix timestamps written by the router lifecycle and UI error logger', () => {
    const timestamp = Math.floor(Date.parse('2026-10-16T17:30:00Z') / 1000);
    expect(formatJournalTimestamp(`unix=${timestamp} level=ERROR component=xkeen-ui source=yaml message=Invalid YAML`, 'Europe/Moscow'))
      .toEqual({ timestamp: '16.10.2026, 20:30:00', message: 'component=xkeen-ui source=yaml message=Invalid YAML' });
  });

  it('leaves lines without an explicit ISO timestamp unchanged', () => {
    expect(formatJournalTimestamp('INFO service started', 'UTC')).toBeNull();
  });
});
