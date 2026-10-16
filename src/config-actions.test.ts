import { describe, expect, it } from 'vitest';
import { canPersistConfig } from './config-actions';

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
