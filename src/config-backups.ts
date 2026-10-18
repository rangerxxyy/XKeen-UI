export interface ConfigBackup {
  id: string;
  size: number;
  modified: number;
}

export function isSafeConfigBackupId(id: string): boolean {
  return /^\.mihomo-config-\d+-\d+\.yaml$/.test(id);
}

export function formatBackupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Размер неизвестен';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  return `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}

export function formatBackupDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000));
}
