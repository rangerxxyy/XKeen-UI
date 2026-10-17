import { describe, expect, it } from 'vitest';
import { renderSelectorSortControl } from './selector-sort-control';

describe('selector sort dropdown', () => {
  it('renders the accessible dark-menu options and preserves the settings preference select', () => {
    const html = renderSelectorSortControl('name');
    expect(html).toContain('data-pref="selectorSort"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-selected="true" data-sort-value="name">По названию');
    expect(html).toContain('data-sort-value="delay">По пингу');
  });
});
