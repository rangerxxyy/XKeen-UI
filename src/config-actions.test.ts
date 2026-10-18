import { describe, expect, it } from 'vitest';
import { canPersistConfig, runConfigApply, CONFIG_APPLY_EVENT, type ConfigApplyEventDetail } from './config-actions';

describe('config persistence actions', () => {
  it('enables save and apply only for a valid changed file with a loaded snapshot', () => {
    expect(canPersistConfig('changed: true', 'original: true', true)).toBe(true);
  });

  it('keeps actions disabled when the content is unchanged, invalid, busy or not loaded', () => {
    expect(canPersistConfig('same', 'same', true)).toBe(false);
    expect(canPersistConfig('changed', 'original', false)).toBe(false);
    expect(canPersistConfig('changed', 'original', true, true)).toBe(false);
    expect(canPersistConfig('changed', null, true)).toBe(false);
  });
});

describe('config apply lifecycle', () => {
  it('keeps restart progress active until the apply operation resolves', async () => {
    const target = new EventTarget();
    const events: ConfigApplyEventDetail[] = [];
    target.addEventListener(CONFIG_APPLY_EVENT, (event) => events.push((event as CustomEvent<ConfigApplyEventDetail>).detail));
    let complete!: (value: string) => void;
    const operation = new Promise<string>((resolve) => { complete = resolve; });
    const pending = runConfigApply('mihomo', () => operation, target);
    await Promise.resolve();
    expect(events).toEqual([{ phase: 'start', core: 'mihomo' }]);
    complete('applied');
    await expect(pending).resolves.toBe('applied');
    expect(events).toEqual([
      { phase: 'start', core: 'mihomo' },
      { phase: 'finish', core: 'mihomo', success: true },
    ]);
  });

  it.each(['rejected promise', 'synchronous throw'])('ends progress and preserves the error for %s', async (failure) => {
    const target = new EventTarget();
    const events: ConfigApplyEventDetail[] = [];
    target.addEventListener(CONFIG_APPLY_EVENT, (event) => events.push((event as CustomEvent<ConfigApplyEventDetail>).detail));
    const error = new Error('Core validation failed');
    const operation = () => {
      if (failure === 'synchronous throw') throw error;
      return Promise.reject(error);
    };
    await expect(runConfigApply('xray', operation, target)).rejects.toBe(error);
    expect(events).toEqual([
      { phase: 'start', core: 'xray' },
      { phase: 'finish', core: 'xray', success: false },
    ]);
  });
});
