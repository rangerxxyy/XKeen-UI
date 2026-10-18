import { describe, expect, it } from 'vitest';
import { canCopyJournal, formatJournalCopy, formatJournalDownload, shouldRefreshJournal } from './journal-controls';

describe('shouldRefreshJournal', () => {
  it('pauses routine polling but keeps polling during a restart', () => {
    expect(shouldRefreshJournal(true, false)).toBe(false);
    expect(shouldRefreshJournal(true, true)).toBe(true);
    expect(shouldRefreshJournal(false, false)).toBe(true);
  });
});

describe('formatJournalCopy', () => {
  it('copies only matching visible lines without backend source labels', () => {
    expect(formatJournalCopy([
      'time="2026-10-18T08:10:00Z" level=ERROR msg="Failed"  [Xray]',
      'time="2026-10-18T08:11:00Z" level=INFO msg="Started"  [Xray]',
    ], 'failed', 'UTC')).toBe('2026/10/18 08:10:00 ERROR Failed');
  });

  it('returns empty text when no rows match', () => {
    expect(formatJournalCopy(['INFO Started'], 'missing', 'UTC')).toBe('');
  });
});

describe('formatJournalDownload', () => {
  it('downloads only matching human-readable records with a final newline', () => {
    expect(formatJournalDownload([
      'time="2026-10-18T08:10:00Z" level=ERROR msg="Failed"  [Xray]',
      'time="2026-10-18T08:11:00Z" level=INFO msg="Started"  [Xray]',
    ], 'failed', 'UTC')).toBe('2026/10/18 08:10:00 ERROR Failed\n');
  });

  it('returns empty output when the current filter has no matching records', () => {
    expect(formatJournalDownload(['INFO Started'], 'missing', 'UTC')).toBe('');
  });
});

describe('canCopyJournal', () => {
  it('enables copying only when visible log rows are available', () => {
    expect(canCopyJournal('data', 'INFO Started')).toBe(true);
    expect(canCopyJournal('data', '')).toBe(false);
    expect(canCopyJournal('error', 'stale previous data')).toBe(false);
    expect(canCopyJournal('cleared', 'old rows')).toBe(false);
  });
});
