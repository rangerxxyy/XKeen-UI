import { describe, expect, it } from 'vitest';
import { getXrayTemplateTarget } from './template-target';

describe('getXrayTemplateTarget', () => {
  it('routes each upstream Xray template to its matching configuration file', () => {
    expect(getXrayTemplateTarget('Log')).toBe('xray_log');
    expect(getXrayTemplateTarget('Inbounds (Режим Mixed)')).toBe('xray_inbounds');
    expect(getXrayTemplateTarget('Inbounds (Режим TProxy+DSCP)')).toBe('xray_inbounds');
    expect(getXrayTemplateTarget('Outbounds')).toBe('xray_json');
    expect(getXrayTemplateTarget('Routing (только заблокированное, zkeen)')).toBe('xray_routing');
    expect(getXrayTemplateTarget('Routing (все в прокси, кроме RU)')).toBe('xray_routing');
    expect(getXrayTemplateTarget('Policy')).toBe('xray_policy');
  });

  it('rejects names outside the bundled Xray catalog', () => {
    expect(getXrayTemplateTarget('custom file')).toBeNull();
  });
});
