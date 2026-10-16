import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from './settings-tabs';
import { DEFAULT_UI_PREFERENCES, readUiPreferences, validPingUrl, writeUiPreferences } from './preferences';

describe('settings navigation', () => {
  it('exposes only the three implemented tabs', () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(['general', 'mihomo', 'sources']);
  });
});

describe('ping URL setting', () => {
  it('accepts a host and optional path without an http scheme', () => {
    expect(validPingUrl('www.gstatic.com/generate_204')).toBe(true);
    expect(validPingUrl('example.com:8080/ping')).toBe(true);
  });

  it('rejects a scheme in the scheme-free address field', () => {
    expect(validPingUrl('https://www.gstatic.com/generate_204')).toBe(false);
  });
});

describe('saved Mihomo and update preferences', () => {
  it('loads existing switch, delay and ping values from the current storage key', () => {
    const stored = new Map<string, string>([['xkeen-ui:preferences:v1', JSON.stringify({
      showConnectionSource: false,
      closeConnectionsAfterApply: true,
      hideUnavailableProxies: true,
      unavailableThreshold: 4,
      pingScheme: 'http',
      pingUrl: 'example.com/check',
      pingTimeoutMs: 7500,
      autoCheckPanel: false,
      autoCheckCore: true,
    })]]);
    const preferences = readUiPreferences({ getItem: (key) => stored.get(key) ?? null });
    expect(preferences).toMatchObject({
      showConnectionSource: false,
      closeConnectionsAfterApply: true,
      hideUnavailableProxies: true,
      unavailableThreshold: 4,
      pingScheme: 'http',
      pingUrl: 'example.com/check',
      pingTimeoutMs: 7500,
      autoCheckPanel: false,
      autoCheckCore: true,
    });
  });

  it('continues saving into the established localStorage key', () => {
    const saved: { key?: string; value?: string } = {};
    writeUiPreferences(DEFAULT_UI_PREFERENCES, { setItem: (key, value) => { saved.key = key; saved.value = value; } });
    expect(saved.key).toBe('xkeen-ui:preferences:v1');
    expect(JSON.parse(saved.value ?? '{}')).toMatchObject(DEFAULT_UI_PREFERENCES);
  });
});

describe('appearance and journal timezone preferences', () => {
  it('provides persistent system-theme and local-time defaults', () => {
    const preferences = readUiPreferences({ getItem: () => null });
    expect(preferences.theme).toBe('system');
    expect(preferences.journalTimeZone).toBe('local');
  });

  it('loads a saved theme and journal timezone without changing the storage key', () => {
    const preferences = readUiPreferences({
      getItem: () => JSON.stringify({ theme: 'light', journalTimeZone: 'Europe/Moscow' }),
    });
    expect(preferences.theme).toBe('light');
    expect(preferences.journalTimeZone).toBe('UTC+3');
  });

  it('supports fixed UTC offsets and migrates legacy city keys', () => {
    const preferences = readUiPreferences({
      getItem: () => JSON.stringify({ journalTimeZone: 'UTC-12' }),
    });
    expect(preferences.journalTimeZone).toBe('UTC-12');
    const migrated = readUiPreferences({
      getItem: () => JSON.stringify({ journalTimeZone: 'Europe/Moscow' }),
    });
    expect(migrated.journalTimeZone).toBe('UTC+3');
  });
});
