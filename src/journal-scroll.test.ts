import { describe, expect, it } from 'vitest';
import { getJournalScrollTop } from './journal-scroll';

describe('getJournalScrollTop', () => {
  it('follows new entries when the reader was at the end', () => {
    expect(getJournalScrollTop({ scrollTop: 600, clientHeight: 300, scrollHeight: 900 }, 1200, 300)).toBe(900);
  });

  it('keeps the reader position when they scrolled up', () => {
    expect(getJournalScrollTop({ scrollTop: 180, clientHeight: 300, scrollHeight: 900 }, 1200, 300)).toBe(180);
  });

  it('starts at the tail on the first render', () => {
    expect(getJournalScrollTop(null, 1200, 300)).toBe(900);
  });
});
