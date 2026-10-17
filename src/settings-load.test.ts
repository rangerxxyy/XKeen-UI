import { describe, expect, it, vi } from 'vitest';
import { createSettingsLoader } from './settings-load';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('editable settings loading', () => {
  it('allows saving only after values have loaded', async () => {
    const pending = deferred<string[]>();
    const apply = vi.fn();
    const changed = vi.fn();
    const loader = createSettingsLoader(() => pending.promise, apply, changed);
    expect(loader.ready).toBe(false);
    const loading = loader.load();
    expect(changed).toHaveBeenLastCalledWith('loading');
    expect(loader.ready).toBe(false);
    pending.resolve(['saved proxy']);
    await loading;
    expect(apply).toHaveBeenCalledWith(['saved proxy']);
    expect(loader.ready).toBe(true);
    expect(changed).toHaveBeenLastCalledWith('ready');
  });

  it('keeps saving disabled on failure and enables it after retrying successfully', async () => {
    const read = vi.fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce([]);
    const apply = vi.fn();
    const changed = vi.fn();
    const loader = createSettingsLoader(read, apply, changed);
    await loader.load();
    expect(loader.ready).toBe(false);
    expect(changed).toHaveBeenLastCalledWith('error', 'API unavailable');
    expect(apply).not.toHaveBeenCalled();
    await loader.load();
    expect(loader.ready).toBe(true);
    expect(apply).toHaveBeenCalledWith([]);
  });

  it('ignores old responses after a retry', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const read = vi.fn<() => Promise<string>>()
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const apply = vi.fn();
    const loader = createSettingsLoader(read, apply, vi.fn());
    const first = loader.load();
    const second = loader.load();
    newer.resolve('current');
    await second;
    older.resolve('obsolete');
    await first;
    expect(loader.ready).toBe(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith('current');
  });

  it('ignores responses when the settings tab has been closed', async () => {
    const pending = deferred<string>();
    const apply = vi.fn();
    const changed = vi.fn();
    const loader = createSettingsLoader(() => pending.promise, apply, changed);
    const loading = loader.load();
    loader.dispose();
    pending.resolve('obsolete');
    await loading;
    expect(loader.ready).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledExactlyOnceWith('loading');
  });
});
