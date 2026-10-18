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
