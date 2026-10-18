import { describe, expect, it } from 'vitest';
import { renderResourceMetrics } from './resource-metrics';

describe('renderResourceMetrics', () => {
  it('renders compact RAM and CPU values with small decorative icons', () => {
    const markup = renderResourceMetrics({ usedMb: 273, totalMb: 486 }, 4.4);

    expect(markup).toContain('RAM 273/486 MB');
    expect(markup).toContain('CPU 4%');
    expect(markup.match(/<svg/g)).toHaveLength(2);
    expect(markup).toContain('aria-hidden="true"');
  });

  it('shows unavailable metrics as placeholders', () => {
    const markup = renderResourceMetrics(null, null);

    expect(markup).toContain('RAM —');
    expect(markup).toContain('CPU —');
  });
});
