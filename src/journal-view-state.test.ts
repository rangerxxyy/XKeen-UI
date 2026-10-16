import { describe, expect, it } from 'vitest';
import { getJournalViewState } from './journal-view-state';

describe('getJournalViewState', () => {
  it('keeps existing journal rows visible while refreshing in the background', () => {
    expect(getJournalViewState({ loading: true, hasData: true, error: null, cleared: false })).toBe('data');
  });

  it('shows a loading state on the first journal request', () => {
    expect(getJournalViewState({ loading: true, hasData: false, error: null, cleared: false })).toBe('loading');
  });

  it('keeps an explicit cleared state while a refresh is running', () => {
    expect(getJournalViewState({ loading: true, hasData: true, error: null, cleared: true })).toBe('cleared');
  });
});
