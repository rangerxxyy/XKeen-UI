export type JournalViewState = 'loading' | 'error' | 'cleared' | 'data' | 'empty';

export function getJournalViewState(input: {
  loading: boolean;
  hasData: boolean;
  error: string | null;
  cleared: boolean;
}): JournalViewState {
  if (input.cleared) return 'cleared';
  if (input.hasData) return 'data';
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  return 'empty';
}
