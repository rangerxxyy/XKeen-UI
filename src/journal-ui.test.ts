import { describe, expect, it } from 'vitest';
import { journalExpandIcon, journalExpandLabel } from './journal-ui';

describe('journal fullscreen control', () => {
  it('uses clear accessible labels for entering and leaving fullscreen', () => {
    expect(journalExpandLabel(false)).toBe('Развернуть журнал на весь экран');
    expect(journalExpandLabel(true)).toBe('Свернуть журнал');
  });

  it('shows distinct vector icons for each fullscreen state', () => {
    expect(journalExpandIcon(false)).toContain('viewBox="0 0 24 24"');
    expect(journalExpandIcon(false)).not.toBe(journalExpandIcon(true));
    expect(journalExpandIcon(true)).toContain('aria-hidden="true"');
  });
});
