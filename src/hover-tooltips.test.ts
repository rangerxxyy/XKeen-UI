import { describe, expect, it } from 'vitest';
import { extractTooltipText, type TooltipTarget } from './hover-tooltips';

function createTarget(title = '', tooltip = ''): TooltipTarget {
  const attributes = new Map<string, string>();
  if (title) attributes.set('title', title);
  return {
    dataset: tooltip ? { tooltip } : {},
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => { attributes.delete(name); },
  };
}

describe('custom hover tooltips', () => {
  it('uses the title as plain tooltip text and removes the browser title', () => {
    const target = createTarget('Маршрут: Main → Finland');

    expect(extractTooltipText(target)).toBe('Маршрут: Main → Finland');
    expect(target.dataset.tooltip).toBe('Маршрут: Main → Finland');
    expect(target.hasAttribute('title')).toBe(false);
  });

  it('keeps explicit tooltip text and does not parse it as HTML', () => {
    const target = createTarget('<b>Узел</b>', 'Proxy provider: <b>Finland</b>');

    expect(extractTooltipText(target)).toBe('Proxy provider: <b>Finland</b>');
    expect(target.hasAttribute('title')).toBe(false);
  });
});
