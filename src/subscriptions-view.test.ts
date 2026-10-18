import { describe, expect, it } from 'vitest';
import { formatProviderUpdated, formatSubscriptionExpiry, formatSubscriptionTraffic } from './subscriptions-view';

describe('subscription provider display', () => {
  it('combines upload and download and shows the quota when Mihomo provides it', () => {
    expect(formatSubscriptionTraffic({ upload: 1024, download: 2048, total: 1048576 })).toBe('3 KB / 1 MB');
    expect(formatSubscriptionTraffic({ upload: 1536, download: 0, total: 0 })).toBe('1,5 KB');
    expect(formatSubscriptionTraffic({ upload: 0, download: 0, total: 0 })).toBe('—');
  });

  it('formats expiry dates and leaves absent metadata empty', () => {
    expect(formatSubscriptionExpiry(null)).toBe('—');
    expect(formatSubscriptionExpiry(0)).toBe('—');
    expect(formatSubscriptionExpiry(Number.NaN)).toBe('—');
  });

  it('shows relative update age from controller metadata', () => {
    expect(formatProviderUpdated('2026-10-18T10:00:00.000Z', Date.parse('2026-10-18T12:00:00.000Z'))).toBe('2 часа назад');
    expect(formatProviderUpdated(null, Date.parse('2026-10-18T12:00:00.000Z'))).toBe('—');
  });
});
