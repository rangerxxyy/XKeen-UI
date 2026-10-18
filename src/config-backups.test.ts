import { describe, expect, it } from 'vitest';
import { formatBackupDate, formatBackupSize, isSafeConfigBackupId } from './config-backups';

describe('Mihomo config backups', () => {
  it('accepts only generated Mihomo YAML backup basenames', () => {
    expect(isSafeConfigBackupId('.mihomo-config-3608-1792253130778141508.yaml')).toBe(true);
    for (const id of ['../config.yaml', '.mihomo-config-1-2.yaml/../../config.yaml', '.mihomo-config-1-2.yml', 'mihomo-config-1-2.yaml', '.mihomo-config-x-2.yaml']) {
      expect(isSafeConfigBackupId(id)).toBe(false);
    }
  });

  it('formats size and timestamp for a readable backup list', () => {
    expect(formatBackupSize(512)).toBe('512 Б');
    expect(formatBackupSize(2048)).toBe('2 КБ');
    expect(formatBackupSize(1024 * 1024)).toBe('1 МБ');
    expect(formatBackupDate(1_792_253_130)).not.toBe('Дата неизвестна');
    expect(formatBackupDate(Number.NaN)).toBe('Дата неизвестна');
  });
});
