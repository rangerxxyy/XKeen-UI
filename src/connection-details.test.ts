import { describe, expect, it } from 'vitest';
import type { MihomoConnection } from './api';
import { renderConnectionDetails } from './connection-details';
import { renderConnections } from './mihomo-view';

const sample: MihomoConnection = {
  id: 'sample-id', host: 'long-host.example', destination: '[2001:db8::1]:443',
  source: '192.0.2.2:1234', sourceIp: '192.0.2.2', network: 'tcp', process: 'browser',
  chains: ['Proxy', 'Europe'], rule: 'DomainSuffix', rulePayload: 'example',
  upload: 1024, download: 2048, start: '2026-10-17T12:00:00Z',
};

describe('connection details', () => {
  it('provides an accessible inspection action without inventing a missing route', () => {
    const html = renderConnections({ uploadTotal: 0, downloadTotal: 0,
      connections: [{ ...sample, chains: [] }] }, false, null);
    expect(html).toContain('data-inspect-connection="sample-id"');
    expect(html).toContain('aria-label="Подробности соединения long-host.example"');
    expect(html).toContain('Маршрут неизвестен');
    expect(html).not.toContain('DIRECT');
  });
  it('shows full addresses, the actual route and metadata already provided by the API', () => {
    const html = renderConnectionDetails(sample, 'Test laptop');
    for (const text of ['long-host.example', '[2001:db8::1]:443', '192.0.2.2:1234',
      'Test laptop', 'TCP', 'browser', 'Europe → Proxy', 'DomainSuffix', 'example', 'sample-id']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Передано');
    expect(html).toContain('Получено');
    expect(html).toContain('Данные на момент открытия');
  });

  it('does not invent a direct route or unknown metadata', () => {
    const html = renderConnectionDetails({ ...sample, chains: [], process: '', rule: '', rulePayload: '', start: '' });
    expect(html).not.toContain('DIRECT');
    expect(html).toContain('Не передано ядром');
  });

  it('escapes metadata, routes and device names instead of rendering HTML', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const html = renderConnectionDetails({ ...sample, host: attack, process: attack,
      source: attack, destination: attack, id: attack, rule: attack, rulePayload: attack,
      chains: [attack] }, attack);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
