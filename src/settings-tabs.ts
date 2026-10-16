export const SETTINGS_TABS = [
  { id: 'general', label: 'Общие' },
  { id: 'mihomo', label: 'Mihomo' },
  { id: 'sources', label: 'Обновления' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];
