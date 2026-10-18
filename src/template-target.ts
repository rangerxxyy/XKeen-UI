export type XrayTemplateTarget = 'xray_log' | 'xray_inbounds' | 'xray_json' | 'xray_routing' | 'xray_policy';

export function getXrayTemplateTarget(name: string): XrayTemplateTarget | null {
  if (name === 'Log') return 'xray_log';
  if (name.startsWith('Inbounds ')) return 'xray_inbounds';
  if (name === 'Outbounds') return 'xray_json';
  if (name.startsWith('Routing ')) return 'xray_routing';
  if (name === 'Policy') return 'xray_policy';
  return null;
}
