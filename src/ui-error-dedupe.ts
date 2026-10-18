const ERROR_REPEAT_COOLDOWN_MS = 60_000;

export function shouldReportUiError(
  message: string,
  now: number,
  recentErrors: Map<string, number>,
  cooldownMs = ERROR_REPEAT_COOLDOWN_MS,
): boolean {
  for (const [previousMessage, timestamp] of recentErrors) {
    if (now - timestamp >= cooldownMs) recentErrors.delete(previousMessage);
  }

  const normalized = message.trim();
  const previousAt = recentErrors.get(normalized);
  if (previousAt !== undefined && now - previousAt < cooldownMs) return false;

  recentErrors.set(normalized, now);
  return true;
}
