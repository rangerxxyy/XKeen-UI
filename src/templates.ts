import mihomoConfigBlocked from './templates/zxc-rv/mihomo/config.yaml?raw';
import mihomoConfigProxyExceptRu from './templates/zxc-rv/mihomo/config_2.yaml?raw';
import xrayLog from './templates/zxc-rv/xray/01_log.json?raw';
import xrayInboundMixed from './templates/zxc-rv/xray/03_inbounds_mixed.json?raw';
import xrayInboundTproxy from './templates/zxc-rv/xray/03_inbounds_tproxy.json?raw';
import xrayInboundMixedDscp from './templates/zxc-rv/xray/03_inbounds_mixed+dscp.json?raw';
import xrayInboundTproxyDscp from './templates/zxc-rv/xray/03_inbounds_tproxy+dscp.json?raw';
import xrayOutbounds from './templates/zxc-rv/xray/04_outbounds.json?raw';
import xrayRoutingBlocked from './templates/zxc-rv/xray/05_routing_1.json?raw';
import xrayRoutingProxyExceptRu from './templates/zxc-rv/xray/05_routing_2.json?raw';
import xrayPolicy from './templates/zxc-rv/xray/06_policy.json?raw';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';

export type ReferenceCore = 'mihomo' | 'xray';

export interface BundledTemplate {
  name: string;
  content: string;
}

// Bundled verbatim from zxc-rv/assets at 8747e7b02af1631fff048bf2d832d3e5370bdb34.
const bundledTemplates: Record<ReferenceCore, BundledTemplate[]> = {
  mihomo: [
    { name: 'Сonfig (только заблокированное, refilter+zkeenip)', content: mihomoConfigBlocked },
    { name: 'Сonfig (все в прокси, кроме RU)', content: mihomoConfigProxyExceptRu },
  ],
  xray: [
    { name: 'Log', content: xrayLog },
    { name: 'Inbounds (Режим Mixed)', content: xrayInboundMixed },
    { name: 'Inbounds (Режим TProxy)', content: xrayInboundTproxy },
    { name: 'Inbounds (Режим Mixed+DSCP)', content: xrayInboundMixedDscp },
    { name: 'Inbounds (Режим TProxy+DSCP)', content: xrayInboundTproxyDscp },
    { name: 'Outbounds', content: xrayOutbounds },
    { name: 'Routing (только заблокированное, zkeen)', content: xrayRoutingBlocked },
    { name: 'Routing (все в прокси, кроме RU)', content: xrayRoutingProxyExceptRu },
    { name: 'Policy', content: xrayPolicy },
  ],
};

export function getBundledTemplates(core: ReferenceCore): BundledTemplate[] {
  return bundledTemplates[core];
}

export function getDefaultTemplate(core: ReferenceCore): BundledTemplate {
  const template = core === 'mihomo'
    ? bundledTemplates.mihomo[0]
    : bundledTemplates.xray.find(({ name }) => name.includes('Routing (только заблокированное'));
  if (!template) throw new Error(`Нет встроенного шаблона для ${core}`);
  return template;
}

function closeDialog(dialog: HTMLDialogElement): void {
  closeDialogWithMotion(dialog);
}

export async function chooseReferenceTemplate(core: ReferenceCore): Promise<{ name: string; content: string } | null> {
  const templates = bundledTemplates[core];
  const dialog = document.createElement('dialog');
  dialog.className = 'template-dialog';
  dialog.setAttribute('aria-labelledby', 'template-dialog-title');

  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('header');
  heading.className = 'template-dialog-heading';
  const icon = document.createElement('span');
  icon.className = 'template-dialog-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▤';
  const title = document.createElement('h2');
  title.id = 'template-dialog-title';
  title.textContent = 'Импорт шаблона';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'template-dialog-close';
  closeButton.setAttribute('aria-label', 'Закрыть');
  closeButton.textContent = '×';
  heading.append(icon, title, closeButton);

  const description = document.createElement('div');
  description.className = 'template-dialog-description';
  const note = document.createElement('p');
  note.append('Выберите готовый шаблон конфигурации для ');
  const coreName = document.createElement('strong');
  coreName.textContent = core === 'mihomo' ? 'Mihomo' : 'Xray';
  note.append(coreName);
  const count = document.createElement('span');
  count.className = 'template-count';
  count.textContent = String(templates.length);
  count.setAttribute('aria-label', `${templates.length} шаблона`);
  description.append(note, count);

  const options = document.createElement('div');
  options.className = 'template-options';
  options.setAttribute('role', 'radiogroup');
  options.setAttribute('aria-label', `Шаблоны ${core === 'mihomo' ? 'Mihomo' : 'Xray'}`);
  let selectedIndex = 0;
  for (const [index, template] of templates.entries()) {
    const label = document.createElement('label');
    label.className = `template-option${index === selectedIndex ? ' is-selected' : ''}`;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'config-template';
    radio.value = String(index);
    radio.checked = index === selectedIndex;
    radio.addEventListener('change', () => {
      selectedIndex = index;
      options.querySelectorAll('.template-option').forEach((item, itemIndex) => item.classList.toggle('is-selected', itemIndex === index));
    });
    const name = document.createElement('span');
    name.className = 'template-option-name';
    name.textContent = template.name;
    label.append(radio, name);
    options.append(label);
  }

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'template-import-button';
  importButton.textContent = 'Импортировать';
  importButton.addEventListener('click', () => {
    const template = templates[selectedIndex];
    if (!template) return;
    dialog.dispatchEvent(new CustomEvent('template-selected', { detail: template }));
    closeDialog(dialog);
  });

  const close = () => closeDialog(dialog);
  closeButton.addEventListener('click', close);
  form.addEventListener('submit', (event) => { event.preventDefault(); close(); });
  form.append(heading, description, options, importButton);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  bindDialogMotion(dialog);
  const result = new Promise<{ name: string; content: string } | null>((resolve) => {
    dialog.addEventListener('template-selected', (event) => resolve((event as CustomEvent<{ name: string; content: string }>).detail), { once: true });
    dialog.addEventListener('close', () => resolve(null), { once: true });
  });
  dialog.showModal();
  return result;
}
