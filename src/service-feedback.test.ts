import { describe, expect, it } from 'vitest';
import { lifecycleFeedback } from './service-feedback';

describe('lifecycleFeedback', () => {
  it('selects the XKeen journal and reports a successful restart', () => {
    expect(lifecycleFeedback('restart')).toEqual({
      logFile: 'xkeen-ui',
      message: 'XKeen перезапущен',
      kind: 'success',
    });
  });

  it('selects the XKeen journal and preserves a failure reason', () => {
    expect(lifecycleFeedback('stop', 'DNS защищён')).toEqual({
      logFile: 'xkeen-ui',
      message: 'DNS защищён',
      kind: 'error',
    });
  });
});
