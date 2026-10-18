export type ReferenceCore = 'mihomo' | 'xray';

export interface ReferenceTemplate {
  name: string;
  url: string;
}

import mihomoBlocked from './templates/mihomo-blocked.yaml?raw';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';
import mihomoProxyExceptRu from './templates/mihomo-proxy-except-ru.yaml?raw';
import xrayBlocked from './templates/xray-blocked.jsonc?raw';
import xrayProxyExceptRu from './templates/xray-proxy-except-ru.json?raw';

export interface BundledTemplate {
  name: string;
  content: string;
}

const bundledTemplates: Record<ReferenceCore, BundledTemplate[]> = {
  mihomo: [
    { name: 'Только заблокированное (zxc-rv)', content: mihomoBlocked },
    { name: 'Всё через PROXY, кроме RU (zxc-rv)', content: mihomoProxyExceptRu },
  ],
  xray: [
    { name: 'Routing: только заблокированное (zxc-rv)', content: xrayBlocked },
    { name: 'Routing: всё через прокси, кроме RU (zxc-rv)', content: xrayProxyExceptRu },
  ],
};

export function getBundledTemplates(core: ReferenceCore): BundledTemplate[] {
  return bundledTemplates[core];
}

export function getDefaultTemplate(core: ReferenceCore): BundledTemplate {
  const template = bundledTemplates[core][0];
  if (!template) throw new Error(`Нет встроенного шаблона для ${core}`);
  return template;
}

const ASSETS_REVISION = '26e20e85ddde31622a7002e6567698c9389b164e';
const ASSETS_ROOT = `https://raw.githubusercontent.com/zxc-rv/assets/${ASSETS_REVISION}/config_templates/`;
const MANIFEST_URL = `${ASSETS_ROOT}templates.json`;
let manifest: Partial<Record<ReferenceCore, ReferenceTemplate[]>> | undefined;

async function getTemplates(core: ReferenceCore): Promise<ReferenceTemplate[]> {
  if (!manifest) {
    const response = await fetch(MANIFEST_URL, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Каталог шаблонов вернул HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Каталог шаблонов имеет неверный формат');
    manifest = data as Partial<Record<ReferenceCore, ReferenceTemplate[]>>;
  }
  const entries = manifest[core];
  if (!Array.isArray(entries)) throw new Error(`В каталоге нет шаблонов для ${core}`);
  return entries.map((item) => {
    if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') throw new Error('Некорректная запись шаблона');
    const url = new URL(item.url);
    if (url.hostname !== 'raw.githubusercontent.com' || url.pathname.split('/').slice(1, 3).join('/') !== 'zxc-rv/assets') {
      throw new Error('Каталог содержит неожиданный источник шаблона');
    }
    const resourcePath = url.pathname.split('/').slice(4).join('/');
    if (!resourcePath.startsWith(`config_templates/${core}/`) || resourcePath.includes('..')) throw new Error('Путь шаблона не прошёл проверку');
    return { name: item.name, url: `${ASSETS_ROOT}${resourcePath}` };
  });
}

function closeDialog(dialog: HTMLDialogElement): void {
  closeDialogWithMotion(dialog);
}

export async function chooseReferenceTemplate(core: ReferenceCore): Promise<{ name: string; content: string } | null> {
  const localTemplates = getBundledTemplates(core);
  let remoteTemplates: ReferenceTemplate[] = [];
  try {
    remoteTemplates = (await getTemplates(core)).filter((item) =>
      !localTemplates.some((local) => local.name === item.name || item.name.toLocaleLowerCase().includes(local.name.includes('PROXY') ? 'все в прокси' : 'только заблокированное')),
    );
  } catch {
    // Bundled defaults stay usable offline if GitHub or its template manifest is unavailable.
  }
  const templates: Array<BundledTemplate | ReferenceTemplate> = [...localTemplates, ...remoteTemplates];
  const dialog = document.createElement('dialog');
  dialog.className = 'template-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h2');
  title.textContent = `Шаблоны ${core === 'mihomo' ? 'Mihomo' : 'Xray'}`;
  const description = document.createElement('p');
  description.textContent = 'Выберите готовую схему маршрутизации. Загрузка заменит текущий черновик в редакторе.';
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
    const copy = document.createElement('span');
    copy.className = 'template-option-copy';
    const name = document.createElement('strong');
    name.textContent = template.name;
    const summary = document.createElement('small');
    summary.textContent = /кроме ru|except.*ru|proxy.*except.*ru/i.test(template.name)
      ? 'Направляет трафик через прокси, сохраняя прямой маршрут для RU.'
      : /заблок|blocked|refilter/i.test(template.name)
        ? 'Отправляет через прокси домены из правил блокировок, остальное — напрямую.'
        : 'Готовая конфигурация. При загрузке её содержимое заменит текущий черновик.';
    copy.append(name, summary);
    label.append(radio, copy);
    options.append(label);
  }
  const status = document.createElement('p');
  status.className = 'template-status';
  status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'template-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'editor-button';
  cancel.textContent = 'Отмена';
  cancel.addEventListener('click', () => closeDialog(dialog));
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'editor-button editor-button-primary';
  importButton.textContent = 'Загрузить в редактор';
  importButton.addEventListener('click', async () => {
    const template = templates[selectedIndex];
    if (!template) return;
    importButton.disabled = true;
    status.textContent = 'Загружаем…';
    try {
      let content: string;
      if ('content' in template) {
        content = template.content;
      } else {
        const response = await fetch(template.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        content = await response.text();
      }
      if (!content.trim() || content.length > 1_000_000) throw new Error('Шаблон пустой или превышает 1 МБ');
      dialog.dispatchEvent(new CustomEvent('template-selected', { detail: { name: template.name, content } }));
      closeDialog(dialog);
    } catch (error) {
      status.textContent = error instanceof Error ? `Не удалось загрузить: ${error.message}` : 'Не удалось загрузить шаблон';
      importButton.disabled = false;
    }
  });
  actions.append(cancel, importButton);
  form.append(title, description, options, status, actions);
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
