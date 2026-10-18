import { describe, expect, it } from 'vitest';
import { bindDnsTextareaGrowth } from './dns-textarea-growth';

describe('DNS textarea growth', () => {
  it('expands a DNS field to fit its content when the user adds lines', () => {
    let inputHandler: (() => void) | undefined;
    const textarea = {
      style: { height: '' },
      scrollHeight: 248,
      addEventListener: (_type: string, handler: () => void) => { inputHandler = handler; },
    };
    bindDnsTextareaGrowth([textarea as unknown as HTMLTextAreaElement]);
    expect(textarea.style.height).toBe('248px');
    textarea.scrollHeight = 392;
    inputHandler?.();
    expect(textarea.style.height).toBe('392px');
  });
});
