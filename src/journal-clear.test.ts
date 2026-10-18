import { describe, expect, it } from 'vitest';
import { hideClearedJournalLines, rememberClearedJournal, type JournalClearStorage } from './journal-clear';

function memoryStorage(): JournalClearStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('persistent journal clear', () => {
  it('keeps old records hidden after a page reload while showing new entries', () => {
    const storage = memoryStorage();
    rememberClearedJournal('error.log', ['old error', 'old info'], storage);

    expect(hideClearedJournalLines('error.log', ['old error', 'old info', 'new error'], storage))
      .toEqual(['new error']);
    // A new app instance uses the same browser storage.
    expect(hideClearedJournalLines('error.log', ['old error', 'new error'], storage))
      .toEqual(['new error']);
  });

  it('tracks identical records by occurrence and keeps files independent', () => {
    const storage = memoryStorage();
    rememberClearedJournal('error.log', ['same', 'same'], storage);

    expect(hideClearedJournalLines('error.log', ['same', 'same', 'same'], storage)).toEqual(['same']);
    expect(hideClearedJournalLines('access.log', ['same'], storage)).toEqual(['same']);
  });
});
