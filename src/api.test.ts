import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyActiveMihomoConfig, getSystemLog, pingMihomoGroup } from './api';

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

describe('applyActiveMihomoConfig', () => {
  it('sends the selected YAML only to the fixed active Mihomo config endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'applied',
      path: '/opt/etc/mihomo/config.yaml',
      backup: '/opt/sbin/core-backup/mihomo-config-test.yaml',
      restarted: true,
      detail: 'Конфигурация применена',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(applyActiveMihomoConfig('mixed-port: 7890\n', 'mixed-port: 7890\n')).resolves.toMatchObject({
      status: 'applied',
      path: '/opt/etc/mihomo/config.yaml',
      restarted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/active', {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'mixed-port: 7890\n', expectedContent: 'mixed-port: 7890\n' }),
      signal: undefined,
    });
  });

  it('rejects an unexpected filesystem target in the API response', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      status: 'saved', path: '/tmp/other.yaml', backup: '/tmp/backup', restarted: false, detail: 'saved',
    }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(applyActiveMihomoConfig('mixed-port: 7890', 'old')).rejects.toThrow('некорректный результат');
  });
});

describe('pingMihomoGroup', () => {
  it('checks a whole group through the backend ping endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [
      { name: 'Finland', delay: 42 }, { name: 'Sweden', delay: null },
    ] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pingMihomoGroup('Main')).resolves.toEqual([
      { name: 'Finland', delay: 42 }, { name: 'Sweden', delay: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/mihomo/proxies/ping', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'Main' }),
      signal: undefined,
    });
  });
});
