export function getJournalScrollTop(
  previous: { scrollTop: number; clientHeight: number; scrollHeight: number } | null,
  nextScrollHeight: number,
  nextClientHeight: number,
): number {
  const nextMaximum = Math.max(0, nextScrollHeight - nextClientHeight);
  if (!previous) return nextMaximum;
  const wasAtBottom = previous.scrollHeight - previous.clientHeight - previous.scrollTop <= 40;
  return wasAtBottom ? nextMaximum : Math.min(previous.scrollTop, nextMaximum);
}

export function getNewJournalLines(previous: string[], next: string[]): string[] {
  if (previous.length === 0) return [];
  if (next.length > previous.length && previous.every((line, index) => next[index] === line)) {
    return next.slice(previous.length).slice(-50);
  }
  const maxOverlap = Math.min(previous.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousStart = previous.length - overlap;
    if (previous.slice(previousStart).every((line, index) => next[index] === line)) {
      return next.slice(overlap).slice(-50);
    }
  }
  return [];
}

export function hasJournalLinesChanged(previous: string[] | null, next: string[]): boolean {
  return previous === null || previous.length !== next.length || previous.some((line, index) => next[index] !== line);
}
