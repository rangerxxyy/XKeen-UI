export type SettingsLoadPhase = 'loading' | 'ready' | 'error';

export interface SettingsLoader {
  readonly ready: boolean;
  load(): Promise<void>;
  dispose(): void;
}

export function createSettingsLoader<T>(
  read: () => Promise<T>,
  apply: (value: T) => void,
  changed: (phase: SettingsLoadPhase, error?: string) => void,
): SettingsLoader {
  let phase: SettingsLoadPhase = 'loading';
  let revision = 0;
  let disposed = false;
  return {
    get ready() { return !disposed && phase === 'ready'; },
    async load() {
      if (disposed) return;
      const request = ++revision;
      phase = 'loading';
      changed(phase);
      try {
        const value = await read();
        if (disposed || revision !== request) return;
        apply(value);
        phase = 'ready';
        changed(phase);
      } catch (error) {
        if (disposed || revision !== request) return;
        phase = 'error';
        changed(phase, error instanceof Error ? error.message : 'Не удалось загрузить настройки.');
      }
    },
    dispose() { disposed = true; revision++; },
  };
}
