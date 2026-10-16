export type XkeenAction = 'start' | 'stop' | 'restart';

export function lifecycleFeedback(action: XkeenAction, error?: string): {
  logFile: 'xkeen-ui';
  message: string;
  kind: 'success' | 'error';
} {
  if (error) return { logFile: 'xkeen-ui', message: error, kind: 'error' };
  const message = action === 'restart' ? 'XKeen перезапущен'
    : action === 'stop' ? 'XKeen остановлен' : 'XKeen запущен';
  return { logFile: 'xkeen-ui', message, kind: 'success' };
}
