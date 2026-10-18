import { describe, expect, it } from 'vitest';
import { shouldReportUiError } from './ui-error-dedupe';

describe('shouldReportUiError', () => {
  it('suppresses identical errors during the cooldown window', () => {
    const recent = new Map<string, number>();

    expect(shouldReportUiError('Mihomo вернул некорректный список соединений', 1_000, recent)).toBe(true);
    expect(shouldReportUiError('Mihomo вернул некорректный список соединений', 1_500, recent)).toBe(false);
    expect(shouldReportUiError('Mihomo вернул некорректный список соединений', 61_001, recent)).toBe(true);
  });

  it('keeps different errors independently reportable', () => {
    const recent = new Map<string, number>();

    expect(shouldReportUiError('Ошибка DNS', 1_000, recent)).toBe(true);
    expect(shouldReportUiError('Ошибка YAML', 1_001, recent)).toBe(true);
  });
});
