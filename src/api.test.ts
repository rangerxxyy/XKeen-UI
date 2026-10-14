import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSystemLog } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('getSystemLog', () => {
  it('requests one fixed log id and validates a bounded response shape', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      file: 'Xray · error.log',
      lines: ['2026-10-14 ERROR failed to start'],
      truncated: true,
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSystemLog('xray-error')).resolves.toEqual({
      file: 'Xray · error.log',
      lines: ['2026-10-14 ERROR failed to start'],
      truncated: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/logs?file=xray-error', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('rejects a response containing non-text log records', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      file: 'Xray · error.log', lines: ['safe', { html: '<script>' }], truncated: false,
    }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(getSystemLog('xray-error')).rejects.toThrow('некорректный формат журнала');
  });
});
