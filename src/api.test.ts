import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyActiveMihomoConfig, applyXrayConfigFile, getMihomoSelectors, getRouterConfigFile, getRouterDeviceList, getSystemLog, getXrayConfigFile, installCoreRelease, logUiError, pingMihomoGroup, pingMihomoProxy, requestAppUpdate, saveActiveMihomoConfig, saveRouterConfigFile, saveXrayConfigFile, validateMihomoConfig } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('getRouterDeviceList', () => {
  it('loads KeeneticOS device names through the same-origin backend endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ host: [{ name: 'Laptop', ip: '192.168.1.20' }] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRouterDeviceList()).resolves.toEqual({ host: [{ name: 'Laptop', ip: '192.168.1.20' }] });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/router/devices', { headers: { Accept: 'application/json' }, signal: undefined });
  });
});

describe('getSystemLog', () => {
  it('requests one fixed log id and validates a bounded response shape', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      file: 'Error Log',
      lines: ['2026-10-14 ERROR failed to start'],
      truncated: true,
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSystemLog('xkeen-ui')).resolves.toEqual({
      file: 'Error Log',
      lines: ['2026-10-14 ERROR failed to start'],
      truncated: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/logs?file=xkeen-ui', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('rejects a response containing non-text log records', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      file: 'Error Log', lines: ['safe', { html: '<script>' }], truncated: false,
    }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(getSystemLog('xkeen-ui')).rejects.toThrow('некорректный формат журнала');
  });
});

describe('logUiError', () => {
  it('sends only a bounded UI error event to the same-origin error log endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logUiError('yaml', 'Ошибка YAML · строка 2')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/logs/ui-error', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'yaml', message: 'Ошибка YAML · строка 2' }),
      signal: undefined,
    });
  });
});

describe('requestAppUpdate', () => {
  it('starts the router updater through the fixed same-origin endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'started' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAppUpdate('v0.3.0')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/app/update', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'v0.3.0' }),
    });
  });
});

describe('installCoreRelease', () => {
  it('sends the persistent-backup preference to the local installer endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      core: 'mihomo', tag: 'v1.19.32', backup: null, restarted: true, detail: 'Ядро установлено',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(installCoreRelease({ core: 'mihomo', tag: 'v1.19.32', asset: 'mihomo-linux-arm64.gz', sha256: 'a'.repeat(64), keepBackup: false }))
      .resolves.toMatchObject({ core: 'mihomo', backup: null });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/cores/install', expect.objectContaining({
      body: JSON.stringify({ core: 'mihomo', tag: 'v1.19.32', asset: 'mihomo-linux-arm64.gz', sha256: 'a'.repeat(64), keepBackup: false }),
    }));
  });
});

describe('XKeen configuration files', () => {
  it('reads the actual port list from the fixed router endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      file: 'port_proxying', path: '/opt/etc/xkeen/port_proxying.lst', content: '80\n443\n',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRouterConfigFile('port_proxying')).resolves.toEqual({
      path: '/opt/etc/xkeen/port_proxying.lst', content: '80\n443\n',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/files/port_proxying', {
      headers: { Accept: 'application/json' }, signal: undefined,
    });
  });

  it('saves with an exact-content precondition and rejects the wrong path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'saved', path: '/opt/etc/xkeen/ip_exclude.lst', backup: '/opt/sbin/core-backup/ip_exclude.lst', detail: 'Сохранён',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveRouterConfigFile('ip_exclude', '1.2.3.4\n', '# old\n')).resolves.toMatchObject({
      path: '/opt/etc/xkeen/ip_exclude.lst',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/files/ip_exclude', {
      method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '1.2.3.4\n', expectedContent: '# old\n' }),
    });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      file: 'ip_exclude', path: '/tmp/other', content: 'wrong',
    }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(getRouterConfigFile('ip_exclude')).rejects.toThrow('некорректный файл');
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

  it('shows the Mihomo validation diagnostic together with HTTP 422', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      error: 'Mihomo отклонил конфигурацию: invalid rule at line 42',
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    const request = applyActiveMihomoConfig('bad: yaml', 'old');
    await expect(request)
      .rejects.toThrow('Применение конфигурации Mihomo: Mihomo отклонил конфигурацию: invalid rule at line 42 (HTTP 422)');
    await expect(request).rejects.toMatchObject({ status: 422 });
  });

  it('keeps the HTTP status and provides a useful fallback for non-JSON failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    }));
    await expect(applyActiveMihomoConfig('mixed-port: 7890', 'old'))
      .rejects.toThrow('Применение конфигурации Mihomo: HTTP 502; backend не вернул сообщение об ошибке');
  });

  it.each([
    ['malformed JSON', '{bad json', 'application/json'],
    ['empty body', '', 'application/json'],
  ])('uses a useful fallback for a %s error body', async (_label, body, contentType) => {
    vi.stubGlobal('fetch', async () => new Response(body, {
      status: 422,
      headers: { 'Content-Type': contentType },
    }));
    await expect(applyActiveMihomoConfig('mixed-port: 7890', 'old'))
      .rejects.toThrow('Применение конфигурации Mihomo: HTTP 422; backend не вернул сообщение об ошибке');
  });

  it('uses a safe fallback when a JSON failure has no error message', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { detail: 'wrong type' } }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(applyActiveMihomoConfig('mixed-port: 7890', 'old'))
      .rejects.toThrow('Применение конфигурации Mihomo: HTTP 422; backend не вернул сообщение об ошибке');
  });
});

describe('saveActiveMihomoConfig', () => {
  it('saves the validated YAML to the active path without applying or restarting it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'saved', path: '/opt/etc/mihomo/config.yaml',
      backup: '/opt/sbin/core-backup/mihomo-config-test.yaml',
      restarted: false, detail: 'Конфигурация сохранена; ядро не перезапускалось',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveActiveMihomoConfig('mixed-port: 7890\n', 'old\n')).resolves.toMatchObject({
      status: 'saved', restarted: false, path: '/opt/etc/mihomo/config.yaml',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/active/save', {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'mixed-port: 7890\n', expectedContent: 'old\n' }),
      signal: undefined,
    });
  });
});

describe('Xray configuration files', () => {
  it('reads only a fixed routing file inside the active Xray config directory', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      file: 'xray_routing', path: '/opt/etc/xray/configs/05_routing.json', content: '{"routing":{}}',
    }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(getXrayConfigFile('xray_routing')).resolves.toEqual({
      path: '/opt/etc/xray/configs/05_routing.json', content: '{"routing":{}}',
    });
  });

  it('saves the selected Xray file through a fixed endpoint with an exact snapshot', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'saved', path: '/opt/etc/xray/configs/04_outbounds.json', backup: '/opt/sbin/core-backup/xray_outbounds-test.json', detail: 'Сохранено',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveXrayConfigFile('xray_outbounds', '{"outbounds":[]}', '{}')).resolves.toMatchObject({
      path: '/opt/etc/xray/configs/04_outbounds.json',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/xray/xray_outbounds', {
      method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '{"outbounds":[]}', expectedContent: '{}' }),
    });
  });

  it('applies an Xray file through its dedicated validated restart endpoint', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      status: 'applied', path: '/opt/etc/xray/configs/05_routing.json', backup: '/opt/sbin/core-backup/xray_routing-test.json',
      restarted: true, detail: 'Проверено и перезапущено',
    }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(applyXrayConfigFile('xray_routing', '{"routing":{}}', '{}')).resolves.toMatchObject({
      status: 'applied', restarted: true, path: '/opt/etc/xray/configs/05_routing.json',
    });
  });
});

describe('validateMihomoConfig', () => {
  it('validates the draft without requesting a config write', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      valid: true, detail: 'Конфигурация прошла проверку активным Mihomo',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(validateMihomoConfig('mixed-port: 7890\n')).resolves.toEqual({
      valid: true, detail: 'Конфигурация прошла проверку активным Mihomo',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/validate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'mixed-port: 7890\n' }),
      signal: undefined,
    });
  });

  it('preserves Mihomo diagnostics from a read-only validation failure', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      error: 'Проверка не пройдена; активный конфиг на роутере не изменялся: invalid field at line 42',
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(validateMihomoConfig('bad: config'))
      .rejects.toThrow('Проверка конфигурации Mihomo: Проверка не пройдена; активный конфиг на роутере не изменялся: invalid field at line 42 (HTTP 422)');
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

describe('pingMihomoProxy', () => {
  it('checks one named node in the selected group', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ name: 'Finland', delay: 42 }] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pingMihomoProxy('Main', 'Finland')).resolves.toEqual({ name: 'Finland', delay: 42 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/mihomo/proxies/ping-one', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'Main', name: 'Finland' }),
      signal: undefined,
    });
  });
});

describe('getMihomoSelectors', () => {
  it('fills subscription entries missing from the live proxy map using provider data', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/providers/proxies')
        ? { providers: { subscription: { proxies: [
          { name: 'Sweden', type: 'VLESS', icon: 'flag-se', alive: true, history: [{ delay: 73 }] },
        ] } } }
        : { proxies: {
          Main: { type: 'Selector', now: 'Sweden', all: ['Finland', 'Sweden', 'Stale entry'] },
          Fastest: { type: 'URLTest', now: 'DIRECT', all: ['DIRECT', 'Finland'] },
          DIRECT: { type: 'Direct', alive: true, history: [{ delay: 8 }] },
          Finland: { type: 'VLESS', alive: true, history: [{ delay: 37 }] },
        } };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    });

    await expect(getMihomoSelectors()).resolves.toEqual([{
      name: 'Main', type: 'Selector', icon: null, current: 'Sweden', options: [
        { name: 'Finland', type: 'VLESS', icon: null, alive: true, delay: 37 },
        { name: 'Sweden', type: 'VLESS', icon: 'flag-se', alive: true, delay: 73 },
      ],
    }, {
      name: 'Fastest', type: 'URLTest', icon: null, current: 'DIRECT', options: [
        { name: 'DIRECT', type: 'Direct', icon: null, alive: true, delay: 8 },
        { name: 'Finland', type: 'VLESS', icon: null, alive: true, delay: 37 },
      ],
    }]);
  });
});
