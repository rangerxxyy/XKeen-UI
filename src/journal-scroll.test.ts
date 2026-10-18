import { describe, expect, it } from 'vitest';
import { getJournalScrollTop, getNewJournalLines, hasJournalLinesChanged } from './journal-scroll';

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

describe('getNewJournalLines', () => {
  it('returns appended entries without treating initial history as new', () => {
    expect(getNewJournalLines(['A', 'B'], ['A', 'B', 'C'])).toEqual(['C']);
    expect(getNewJournalLines([], ['A', 'B'])).toEqual([]);
  });

  it('finds new entries when the bounded journal tail rolls forward', () => {
    expect(getNewJournalLines(['A', 'B', 'C'], ['B', 'C', 'D'])).toEqual(['D']);
  });

  it('does not animate the whole journal after truncation or rotation', () => {
    expect(getNewJournalLines(['old A', 'old B'], ['new A', 'new B'])).toEqual([]);
  });
});

describe('hasJournalLinesChanged', () => {
  it('detects content changes but avoids redraws for identical refreshes', () => {
    expect(hasJournalLinesChanged(null, ['A'])).toBe(true);
    expect(hasJournalLinesChanged(['A', 'B'], ['A', 'B'])).toBe(false);
    expect(hasJournalLinesChanged(['A', 'B'], ['A', 'C'])).toBe(true);
  });
});
