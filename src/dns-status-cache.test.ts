import { describe, expect, it, vi } from 'vitest';
import { createAsyncStatusCache } from './dns-status-cache';

describe('DNS status cache', () => {
  it('reuses a fresh status across visits and deduplicates pending requests', async () => {
    const cache = createAsyncStatusCache<{ active: boolean }>();
    const load = vi.fn().mockResolvedValue({ active: true });

    const first = cache.get(load);
    const concurrent = cache.get(load);
    await expect(first).resolves.toEqual({ active: true });
    await expect(concurrent).resolves.toEqual({ active: true });
    await expect(cache.get(load)).resolves.toEqual({ active: true });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refreshes after invalidation and lets a failed read retry', async () => {
    const cache = createAsyncStatusCache<string>();
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('fresh');

    await expect(cache.get(load)).rejects.toThrow('offline');
    await expect(cache.get(load)).resolves.toBe('fresh');
    cache.invalidate();
    await expect(cache.get(load)).resolves.toBe('fresh');

    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not let an older in-flight read overwrite a forced refresh', async () => {
    const cache = createAsyncStatusCache<string>();
    let resolveOld!: (value: string) => void;
    const oldRevision = cache.currentRevision();
    const oldRead = cache.get(() => new Promise((resolve) => { resolveOld = resolve; }));
    cache.invalidate();
    const freshRevision = cache.currentRevision();
    await expect(cache.get(async () => 'fresh')).resolves.toBe('fresh');
    resolveOld('stale');
    await oldRead;
    expect(cache.peek()).toBe('fresh');
    expect(cache.isCurrent(oldRevision)).toBe(false);
    expect(cache.isCurrent(freshRevision)).toBe(true);
  });
});
