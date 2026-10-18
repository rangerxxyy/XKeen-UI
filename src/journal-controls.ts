import { deduplicateRepeatedUiErrors, formatJournalTimestamp, splitJournalLevel, stripLogSourceLabel } from './journal-view-state';

export function shouldRefreshJournal(paused: boolean, restartInProgress: boolean): boolean {
  return !paused || restartInProgress;
}

export function canCopyJournal(viewState: string, visibleText: string): boolean {
  return viewState === 'data' && visibleText.length > 0;
}

export function formatJournalCopy(lines: string[], filter: string, timeZone: string): string {
  const query = filter.trim().toLocaleLowerCase();
  return deduplicateRepeatedUiErrors(lines)
    .filter((line) => !query || line.toLocaleLowerCase().includes(query))
    .map((line) => {
      const visibleLine = stripLogSourceLabel(line);
      const parsed = formatJournalTimestamp(visibleLine, timeZone);
      const severity = splitJournalLevel(parsed?.message ?? visibleLine, visibleLine);
      return [parsed?.timestamp, severity.level, severity.message].filter(Boolean).join(' ');
    })
    .join('\n');
}
