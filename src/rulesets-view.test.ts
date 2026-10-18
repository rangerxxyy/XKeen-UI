import { describe, expect, it } from 'vitest';
import { formatRuleUpdatedAt } from './rulesets-view';

describe('rule-set provider display', () => {
  it('formats update timestamps as readable relative time', () => {
    expect(formatRuleUpdatedAt('2026-10-18T10:00:00.000Z', Date.parse('2026-10-18T12:00:00.000Z'))).toBe('2 часа назад');
    expect(formatRuleUpdatedAt(null)).toBe('—');
    expect(formatRuleUpdatedAt('invalid')).toBe('—');
  });
});
