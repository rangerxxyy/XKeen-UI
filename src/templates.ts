export type ReferenceCore = 'mihomo' | 'xray';

export interface ReferenceTemplate {
  name: string;
  url: string;
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
  dialog.close();
  dialog.remove();
}

export async function chooseReferenceTemplate(core: ReferenceCore): Promise<{ name: string; content: string } | null> {
  const templates = await getTemplates(core);
  const dialog = document.createElement('dialog');
  dialog.className = 'template-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h2');
  title.textContent = `Шаблоны ${core === 'mihomo' ? 'Mihomo' : 'Xray'}`;
  const description = document.createElement('p');
  description.textContent = 'Шаблоны загружаются из закреплённой ревизии zxc-rv/assets. При импорте текущий локальный черновик заменится.';
  const select = document.createElement('select');
  select.className = 'template-select';
  for (const [index, template] of templates.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = template.name;
    select.append(option);
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
    const template = templates[Number(select.value)];
    if (!template) return;
    importButton.disabled = true;
    status.textContent = 'Загружаем…';
    try {
      const response = await fetch(template.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      if (!content.trim() || content.length > 1_000_000) throw new Error('Шаблон пустой или превышает 1 МБ');
      dialog.dispatchEvent(new CustomEvent('template-selected', { detail: { name: template.name, content } }));
      closeDialog(dialog);
    } catch (error) {
      status.textContent = error instanceof Error ? `Не удалось загрузить: ${error.message}` : 'Не удалось загрузить шаблон';
      importButton.disabled = false;
    }
  });
  actions.append(cancel, importButton);
  form.append(title, description, select, status, actions);
  dialog.append(form);
  document.body.append(dialog);
  const result = new Promise<{ name: string; content: string } | null>((resolve) => {
    dialog.addEventListener('template-selected', (event) => resolve((event as CustomEvent<{ name: string; content: string }>).detail), { once: true });
    dialog.addEventListener('close', () => resolve(null), { once: true });
  });
  dialog.showModal();
  return result;
}
