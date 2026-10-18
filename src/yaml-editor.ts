import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { isMap, isSeq, parseDocument } from 'yaml';
import { chooseReferenceTemplate, getDefaultTemplate } from './templates';
import { getXrayTemplateTarget } from './template-target';
import { applyActiveMihomoConfig, applyXrayConfigFile, getActiveMihomoConfig, getRouterConfigFile, getXrayConfigFile, listMihomoConfigBackups, logUiError, restoreMihomoConfigBackup, saveActiveMihomoConfig, saveRouterConfigFile, saveXrayConfigFile, type RouterConfigFile, type XrayConfigFile } from './api';
import { confirmInApp } from './confirm-dialog';
import { canPersistConfig, runConfigApply } from './config-actions';
import { generateConfigForCore } from './outbound-parser';
import { appendMihomoProxy } from './proxy-import';
import { createMihomoProviderYaml, insertMihomoProvider, nextMihomoProviderName, type MihomoProviderPosition, type MihomoProviderSettings } from './mihomo-provider';
import { formatBackupDate, formatBackupSize } from './config-backups';
import { convertAmneziaConfig, renderAmneziaImportActionMarkup } from './amnezia-import';
import { mountUsefulLinksMenu } from './useful-links';
import { formatConfigContent } from './config-format';

const draftKey = 'xkeen-ui:draft:';
const activeFileKey = 'xkeen-ui:draft-active-file';
const draftFiles = [
  { id: 'config', label: 'config', filename: 'config.yaml', format: 'yaml' },
  { id: 'ip_exclude', label: 'ip_exclude', filename: 'ip_exclude.lst', format: 'text' },
  { id: 'port_exclude', label: 'port_exclude', filename: 'port_exclude.lst', format: 'text' },
  { id: 'port_proxying', label: 'port_proxying', filename: 'port_proxying.lst', format: 'text' },
  { id: 'xkeen', label: 'xkeen', filename: 'xkeen.json', format: 'json' },
  { id: 'xray_log', label: 'log', filename: '01_log.json', format: 'json' },
  { id: 'xray_inbounds', label: 'inbounds', filename: '03_inbounds.json', format: 'json' },
  { id: 'xray_json', label: 'config', filename: '04_outbounds.json', format: 'json' },
  { id: 'xray_routing', label: 'routing', filename: '05_routing.json', format: 'jsonc' },
  { id: 'xray_policy', label: 'policy', filename: '06_policy.json', format: 'json' },
] as const;
let editor: EditorView | null = null;
let editorBindings: AbortController | null = null;
let editorEditing = false;
let editorReadOnly = new Compartment();
let editorEditable = new Compartment();
let activeFile = sessionStorage.getItem(activeFileKey) ?? 'config';
if (activeFile === 'xray_jsonc') activeFile = 'xray_routing';
let activeConfigSnapshot: string | null = null;
const listSnapshots = new Map<RouterConfigFile, string>();
const xraySnapshots = new Map<XrayConfigFile, string>();
let configActionBusy = false;
let currentDocumentValid = false;
let lastLoggedValidationError: string | null = null;

function isRouterConfigFile(file: string): file is RouterConfigFile {
  return file === 'ip_exclude' || file === 'port_exclude' || file === 'port_proxying' || file === 'xkeen';
}

function isXrayConfigFile(file: string): file is XrayConfigFile {
  return file === 'xray_log' || file === 'xray_inbounds' || file === 'xray_json' || file === 'xray_routing' || file === 'xray_policy';
}

function xrayApiFile(file: string): XrayConfigFile {
  const files: Record<string, XrayConfigFile> = {
    xray_log: 'xray_log', xray_inbounds: 'xray_inbounds', xray_json: 'xray_outbounds',
    xray_routing: 'xray_routing', xray_policy: 'xray_policy',
  };
  return files[file] ?? 'xray_outbounds';
}

function currentSnapshot(): string | null {
  return currentFile().id === 'config' ? activeConfigSnapshot
    : isRouterConfigFile(currentFile().id) ? listSnapshots.get(currentFile().id as RouterConfigFile) ?? null
      : isXrayConfigFile(currentFile().id) ? xraySnapshots.get(xrayApiFile(currentFile().id)) ?? null : null;
}

function currentFile() {
  return draftFiles.find((file) => file.id === activeFile) ?? draftFiles[0];
}

function syncConfigActions(content: string, valid = currentDocumentValid): void {
  const enabled = canPersistConfig(content, currentSnapshot(), valid, configActionBusy);
  const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
  if (applyButton) applyButton.disabled = !enabled;
  const saveButton = document.querySelector<HTMLButtonElement>('#config-save-active');
  if (saveButton) saveButton.disabled = !enabled;
  const formatButton = document.querySelector<HTMLButtonElement>('#config-format-active');
  if (formatButton) formatButton.disabled = !content.trim() || currentFile().format === 'text' || configActionBusy;
}

function setEditorIdentity(routerMode: boolean, activeCore: 'mihomo' | 'xray' | null): void {
  const file = currentFile();
  document.querySelectorAll<HTMLButtonElement>('[data-config-file]').forEach((button) => {
    const selected = button.dataset.configFile === file.id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll<HTMLElement>('[data-router-file]').forEach((element) => {
    element.hidden = file.id !== 'config' && !isRouterConfigFile(file.id) && !isXrayConfigFile(file.id);
  });
  const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
  if (applyButton) applyButton.hidden = file.id !== 'config' && !isXrayConfigFile(file.id);
  const saveButton = document.querySelector<HTMLButtonElement>('#config-save-active');
  if (saveButton) saveButton.hidden = !routerMode;
  const formatButton = document.querySelector<HTMLButtonElement>('#config-format-active');
  if (formatButton) formatButton.hidden = file.format === 'text';
  document.querySelectorAll<HTMLElement>('[data-structured-only]').forEach((element) => {
    element.hidden = file.format === 'text';
  });
  const templateButton = document.querySelector<HTMLElement>('#yaml-template');
  if (templateButton) templateButton.hidden = file.id === 'xkeen' || file.format === 'text';
  const addProxyButton = document.querySelector<HTMLElement>('#yaml-add-proxy');
  if (addProxyButton) addProxyButton.hidden = file.id !== 'config' || activeCore !== 'mihomo';
  const backupsButton = document.querySelector<HTMLElement>('#yaml-backups');
  if (backupsButton) backupsButton.hidden = !routerMode || file.id !== 'config' || activeCore !== 'mihomo';
}

function bindConfigBackups(signal: AbortSignal): void {
  document.querySelector<HTMLButtonElement>('#yaml-backups')?.addEventListener('click', async (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const dialog = document.createElement('dialog');
    dialog.className = 'modal config-backups-dialog';
    dialog.setAttribute('aria-labelledby', 'config-backups-title');
    dialog.innerHTML = `<section class="modal-panel"><header class="modal-heading"><span class="modal-icon" aria-hidden="true">◷</span><h2 id="config-backups-title">Резервные копии Mihomo</h2><button class="icon-button" type="button" data-close-backups aria-label="Закрыть">×</button></header><p class="modal-note">Выберите сохранённый config.yaml. Перед восстановлением панель проверит конфигурацию, сохранит текущую версию и перезапустит Mihomo.</p><div class="config-backups-list" aria-live="polite"><p class="config-backups-empty">Загружаем список…</p></div></section>`;
    document.body.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-close-backups]')?.addEventListener('click', close, { signal });
    dialog.addEventListener('click', (clickEvent) => { if (clickEvent.target === dialog) close(); }, { signal });
    dialog.showModal();
    const list = dialog.querySelector<HTMLElement>('.config-backups-list');
    try {
      const backups = await listMihomoConfigBackups(signal);
      if (!list || !dialog.isConnected) return;
      list.replaceChildren();
      if (!backups.length) {
        const empty = document.createElement('p'); empty.className = 'config-backups-empty'; empty.textContent = 'Сохранённых резервных копий пока нет.'; list.append(empty); return;
      }
      for (const backup of backups) {
        const row = document.createElement('article'); row.className = 'config-backup-row';
        const details = document.createElement('div'); details.className = 'config-backup-details';
        const name = document.createElement('strong'); name.textContent = formatBackupDate(backup.modified);
        const meta = document.createElement('span'); meta.textContent = `${formatBackupSize(backup.size)} · ${backup.id}`;
        details.append(name, meta);
        const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'editor-button editor-button-primary'; restore.textContent = 'Восстановить';
        restore.addEventListener('click', async () => {
          if (!(await confirmInApp('Восстановить конфигурацию?', 'Текущий config.yaml будет сохранён в резервную копию, затем выбранный файл пройдёт проверку Mihomo и будет применён с перезапуском ядра.', 'Восстановить'))) return;
          restore.disabled = true; restore.textContent = 'Проверка…';
          try {
            const current = await getActiveMihomoConfig(signal);
            const result = await runConfigApply('mihomo', () => restoreMihomoConfigBackup(backup.id, current.content, signal));
            const restored = await getActiveMihomoConfig(signal);
            activeConfigSnapshot = restored.content;
            if (editor && currentFile().id === 'config') {
              enableEditorEditing();
              editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: restored.content } });
              editor.focus();
            }
            setValidation(result.restarted
              ? 'Резервная копия проверена Mihomo, восстановлена и ядро перезапущено'
              : 'Резервная копия проверена Mihomo и восстановлена; ядро сейчас не запущено', true);
            close();
          } catch (cause) {
            restore.disabled = false; restore.textContent = 'Повторить';
            const message = cause instanceof Error ? cause.message : 'Не удалось восстановить резервную копию.';
            setValidation(`Восстановление не выполнено: ${message}`, false);
          }
        }, { signal });
        row.append(details, restore); list.append(row);
      }
    } catch (cause) {
      if (list) { list.replaceChildren(); const error = document.createElement('p'); error.className = 'config-backups-empty is-error'; error.textContent = cause instanceof Error ? cause.message : 'Не удалось загрузить резервные копии.'; list.append(error); }
    }
  }, { signal });
}

function bindAmneziaImportDialog(signal: AbortSignal): void {
  const menu = document.querySelector<HTMLElement>('.editor-utilities-menu');
  if (!menu) return;
  let trigger = document.querySelector<HTMLButtonElement>('#yaml-import-amnezia');
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.id = 'yaml-import-amnezia';
    trigger.type = 'button';
    trigger.setAttribute('role', 'menuitem');
    trigger.innerHTML = '<span class="utility-icon" aria-hidden="true">⇧</span><span>Импорт AmneziaWG</span>';
    menu.append(trigger);
  }
  const addConnectionButton = menu.querySelector('#yaml-add-proxy');
  const templateButton = menu.querySelector('#yaml-template');
  if (addConnectionButton) menu.insertBefore(trigger, addConnectionButton.nextSibling);
  else if (templateButton) menu.insertBefore(trigger, templateButton);
  trigger.hidden = currentFile().id !== 'config';
  trigger.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const dialog = document.createElement('dialog');
    dialog.className = 'modal amnezia-import-dialog';
    dialog.setAttribute('aria-labelledby', 'amnezia-import-title');
    dialog.innerHTML = `<form class="modal-panel" method="dialog">
      <header class="modal-heading"><span class="modal-icon" aria-hidden="true">⇧</span><h2 id="amnezia-import-title">Импорт AmneziaWG</h2><button class="icon-button" type="button" data-amnezia-close aria-label="Закрыть">×</button></header>
      <p class="modal-note">Выберите конфигурацию AmneziaWG (.conf), чтобы преобразовать её в прокси Mihomo.</p>
      <input class="amnezia-file-input" type="file" accept=".conf,.cfg,text/plain" aria-label="Файл конфигурации AmneziaWG">
      <button class="amnezia-dropzone" type="button" data-amnezia-pick><span class="amnezia-upload-icon" aria-hidden="true">⇧</span><strong>Перетащите файл .conf сюда</strong><span>или нажмите для выбора файла</span></button>
      <p class="amnezia-file-name" data-amnezia-filename hidden></p>
      <p class="amnezia-import-error" data-amnezia-error role="alert" hidden></p>
      <section class="amnezia-preview" data-amnezia-preview hidden><div class="amnezia-preview-heading"><span data-amnezia-version></span><button class="editor-button" type="button" data-amnezia-reset>Выбрать другой файл</button></div><pre data-amnezia-yaml></pre></section>
      <footer class="amnezia-import-actions" data-amnezia-actions hidden>${renderAmneziaImportActionMarkup()}</footer>
    </form>`;
    document.body.append(dialog);
    const input = dialog.querySelector<HTMLInputElement>('.amnezia-file-input')!;
    const dropzone = dialog.querySelector<HTMLButtonElement>('[data-amnezia-pick]')!;
    const preview = dialog.querySelector<HTMLElement>('[data-amnezia-preview]')!;
    const actions = dialog.querySelector<HTMLElement>('[data-amnezia-actions]')!;
    const filename = dialog.querySelector<HTMLElement>('[data-amnezia-filename]')!;
    const error = dialog.querySelector<HTMLElement>('[data-amnezia-error]')!;
    let generated = '';
    let importedName = '';
    const close = () => { dialog.close(); dialog.remove(); };
    const reset = () => {
      generated = ''; importedName = ''; input.value = '';
      preview.hidden = true; actions.hidden = true; filename.hidden = true; error.hidden = true;
      dropzone.hidden = false;
    };
    const loadFile = async (file?: File) => {
      if (!file) return;
      reset();
      if (!/\.(conf|cfg)$/i.test(file.name) && file.type !== 'text/plain') {
        error.textContent = 'Выберите текстовый файл .conf или .cfg.'; error.hidden = false; return;
      }
      try {
        const converted = convertAmneziaConfig(await file.text(), file.name);
        generated = converted.yaml; importedName = file.name;
        filename.textContent = `Файл: ${file.name}`; filename.hidden = false;
        dialog.querySelector<HTMLElement>('[data-amnezia-version]')!.textContent = `WIREGUARD / AMNEZIAWG · AWG ${converted.version.version}${converted.version.confidence === 'minimum' ? '+' : ''}`;
        dialog.querySelector<HTMLElement>('[data-amnezia-yaml]')!.textContent = converted.previewYaml;
        preview.hidden = false; actions.hidden = false; dropzone.hidden = true;
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : 'Не удалось обработать конфигурацию AmneziaWG.';
        error.hidden = false;
      }
    };
    input.addEventListener('change', () => { void loadFile(input.files?.[0]); }, { signal });
    dropzone.addEventListener('click', () => input.click(), { signal });
    dropzone.addEventListener('dragover', (dragEvent) => { dragEvent.preventDefault(); dropzone.classList.add('is-dragging'); }, { signal });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'), { signal });
    dropzone.addEventListener('drop', (dropEvent) => {
      dropEvent.preventDefault(); dropzone.classList.remove('is-dragging');
      void loadFile(dropEvent.dataTransfer?.files[0]);
    }, { signal });
    dialog.querySelector('[data-amnezia-reset]')?.addEventListener('click', reset, { signal });
    dialog.querySelector('[data-amnezia-close]')?.addEventListener('click', close, { signal });
    dialog.querySelector<HTMLButtonElement>('[data-amnezia-add]')?.addEventListener('click', () => {
      if (!editor || currentFile().id !== 'config' || !generated) return;
      try {
        const current = editor.state.doc.toString();
        const updated = appendMihomoProxy(current, generated);
        enableEditorEditing();
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
        editor.focus();
        validateStructuredDocument(updated);
        setValidation(`Прокси AmneziaWG из «${importedName}» добавлен в локальный черновик. Проверьте YAML перед применением.`, true);
        close();
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : 'Не удалось добавить прокси в конфигурацию.';
        error.hidden = false;
      }
    }, { signal });
    dialog.addEventListener('click', (clickEvent) => { if (clickEvent.target === dialog) close(); }, { signal });
    dialog.showModal();
  }, { signal });
}

function bindAddProxyDialog(signal: AbortSignal): void {
  document.querySelector<HTMLButtonElement>('#yaml-add-proxy')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const dialog = document.createElement('dialog');
    dialog.className = 'modal proxy-import-dialog';
    dialog.innerHTML = `<form class="modal-panel" method="dialog" id="proxy-import-form">
      <div class="modal-heading"><span class="modal-icon" aria-hidden="true">↗</span><h2>Добавить подключение</h2><button class="icon-button" type="button" data-close-proxy-import aria-label="Закрыть">×</button></div>
      <p class="modal-note">Вставьте ссылку на отдельный узел или URL подписки Mihomo.</p>
      <section class="proxy-provider-editor" hidden>
        <div class="proxy-import-tabs" role="tablist" aria-label="Предпросмотр провайдера">
          <button type="button" class="is-active" role="tab" aria-selected="true" data-provider-tab="settings">Настройки</button>
          <button type="button" role="tab" aria-selected="false" data-provider-tab="yaml">YAML</button>
          <button type="button" class="proxy-provider-copy" data-copy-provider-yaml aria-label="Скопировать YAML" title="Скопировать YAML">▢</button>
        </div>
        <div class="proxy-provider-settings" data-provider-panel="settings">
          <fieldset class="proxy-provider-group"><legend>Основное</legend><div class="proxy-provider-grid">
            <label class="proxy-provider-field"><span>Название провайдера</span><input name="providerName" value="subscription_1" autocomplete="off"></label>
            <label class="proxy-provider-field"><span>Интервал автообновления</span><span class="proxy-provider-unit"><input name="interval" type="number" min="60" step="1" value="43200"><small>сек</small></span></label>
            <label class="proxy-provider-field proxy-provider-wide"><span>URL подписки</span><input name="subscriptionUrl" type="url" autocomplete="url" required></label>
            <p class="proxy-provider-hint proxy-provider-wide">Mihomo будет обновлять этот источник по заданному интервалу.</p>
          </div></fieldset>
          <fieldset class="proxy-provider-group"><legend>Добавить в группы прокси</legend><p class="proxy-provider-hint">Выберите группы, в которых Mihomo должен показывать узлы этой подписки.</p><div class="proxy-provider-groups" data-provider-groups><span class="proxy-provider-hint">Сначала выберите корректную конфигурацию с proxy-groups.</span></div></fieldset>
          <fieldset class="proxy-provider-group"><legend><label class="proxy-provider-toggle"><input name="healthCheckEnabled" type="checkbox" checked><span>Проверка работоспособности</span></label></legend><div class="proxy-provider-grid" data-provider-section="health">
            <label class="proxy-provider-field proxy-provider-wide"><span>URL проверки</span><input name="healthCheckUrl" type="url" value="https://www.gstatic.com/generate_204"></label>
            <label class="proxy-provider-field"><span>Интервал проверок</span><span class="proxy-provider-unit"><input name="healthCheckInterval" type="number" min="1" value="300"><small>сек</small></span></label>
            <label class="proxy-provider-field"><span>Ожидаемый HTTP-код ответа</span><input name="expectedStatus" type="number" min="100" max="599" value="204"></label>
          </div></fieldset>
          <fieldset class="proxy-provider-group"><legend><label class="proxy-provider-toggle"><input name="headersEnabled" type="checkbox" checked><span>Заголовки</span></label></legend><div class="proxy-provider-grid" data-provider-section="headers">
            <label class="proxy-provider-field"><span>User-Agent</span><input name="userAgent" value="ClashMeta/1.19.30; mihomo/1.19.30"></label>
            <label class="proxy-provider-field"><span>x-hwid</span><input name="hwid" autocomplete="off"></label>
          </div></fieldset>
          <fieldset class="proxy-provider-group"><legend><label class="proxy-provider-toggle"><input name="filtersEnabled" type="checkbox"><span>Фильтр подключений</span></label></legend><div class="proxy-provider-grid" data-provider-section="filters" hidden>
            <label class="proxy-provider-field proxy-provider-wide"><span>По названию (включить)</span><input name="filter" placeholder="my-good-proxy"></label>
            <label class="proxy-provider-field proxy-provider-wide"><span>По названию (исключить)</span><input name="excludeFilter" placeholder="my-bad-proxy"></label>
            <label class="proxy-provider-field proxy-provider-wide"><span>По типу (исключить)</span><input name="excludeType" placeholder="trojan|vmess"></label>
          </div></fieldset>
          <label class="proxy-provider-udp"><input name="udp" type="checkbox" checked><span>Включить UDP</span></label>
        </div>
        <pre class="proxy-provider-yaml" data-provider-panel="yaml" hidden></pre>
        <div class="proxy-provider-actions">
          <button type="button" class="editor-button" data-provider-insert="start">＋ В начало</button>
          <button type="button" class="editor-button" data-provider-insert="end">＋ В конец</button>
          <button type="button" class="editor-button" data-provider-open-replace>⧉ Заменить</button>
          <div class="proxy-provider-replace" hidden><select name="replaceTarget" aria-label="Провайдер для замены"><option value="">Выберите провайдера</option></select><button type="button" class="editor-button" data-provider-insert="replace">Подтвердить</button></div>
        </div>
      </section>
      <label class="proxy-import-field"><span>Ссылка на подключение</span><input name="uri" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="vless://… или https://…" required></label>
      <p class="proxy-import-error" role="alert" hidden></p>
      <div class="proxy-import-footer"><button class="editor-button" type="button" data-close-proxy-import>Отмена</button><button class="editor-button editor-button-primary" type="button" data-generate-provider>Сгенерировать</button></div>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector<HTMLFormElement>('#proxy-import-form');
    const input = form?.querySelector<HTMLInputElement>('[name="uri"]');
    const error = form?.querySelector<HTMLElement>('.proxy-import-error');
    const providerEditor = form?.querySelector<HTMLElement>('.proxy-provider-editor');
    const yamlPreview = form?.querySelector<HTMLElement>('.proxy-provider-yaml');
    const providerSettings = form?.querySelector<HTMLElement>('.proxy-provider-settings');
    const providerGroups = form?.querySelector<HTMLElement>('[data-provider-groups]');
    const generateButton = form?.querySelector<HTMLButtonElement>('[data-generate-provider]');
    const close = () => { if (dialog.open) dialog.close(); else dialog.remove(); };
    signal.addEventListener('abort', close, { once: true });
    dialog.querySelectorAll<HTMLButtonElement>('[data-close-proxy-import]').forEach((button) => button.addEventListener('click', close, { signal }));
    dialog.addEventListener('close', () => dialog.remove(), { once: true, signal });

    const setting = <T extends Element>(name: string) => form?.elements.namedItem(name) as T | null;
    const settingsValue = (): MihomoProviderSettings => ({
      name: setting<HTMLInputElement>('providerName')?.value ?? '',
      url: setting<HTMLInputElement>('subscriptionUrl')?.value ?? '',
      interval: Number(setting<HTMLInputElement>('interval')?.value),
      healthCheckEnabled: setting<HTMLInputElement>('healthCheckEnabled')?.checked ?? false,
      healthCheckUrl: setting<HTMLInputElement>('healthCheckUrl')?.value ?? '',
      healthCheckInterval: Number(setting<HTMLInputElement>('healthCheckInterval')?.value),
      expectedStatus: Number(setting<HTMLInputElement>('expectedStatus')?.value),
      headersEnabled: setting<HTMLInputElement>('headersEnabled')?.checked ?? false,
      userAgent: setting<HTMLInputElement>('userAgent')?.value ?? '',
      hwid: setting<HTMLInputElement>('hwid')?.value ?? '',
      udp: setting<HTMLInputElement>('udp')?.checked ?? false,
      filtersEnabled: setting<HTMLInputElement>('filtersEnabled')?.checked ?? false,
      filter: setting<HTMLInputElement>('filter')?.value ?? '',
      excludeFilter: setting<HTMLInputElement>('excludeFilter')?.value ?? '',
      excludeType: setting<HTMLInputElement>('excludeType')?.value ?? '',
    });
    const refreshPreview = () => {
      if (!yamlPreview) return;
      try {
        yamlPreview.textContent = createMihomoProviderYaml(settingsValue());
        if (error) error.hidden = true;
      } catch (cause) {
        yamlPreview.textContent = '';
        if (error) { error.hidden = false; error.textContent = cause instanceof Error ? cause.message : 'Проверьте параметры провайдера.'; }
      }
    };
    form?.querySelector<HTMLButtonElement>('[data-copy-provider-yaml]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(createMihomoProviderYaml(settingsValue()));
        const copy = form.querySelector<HTMLButtonElement>('[data-copy-provider-yaml]');
        if (copy) { copy.textContent = '✓'; copy.setAttribute('aria-label', 'YAML скопирован'); }
      } catch {
        if (error) { error.hidden = false; error.textContent = 'Браузер не разрешил копирование YAML.'; }
      }
    }, { signal });
    form?.querySelectorAll<HTMLInputElement>('.proxy-provider-settings input').forEach((control) => control.addEventListener('input', refreshPreview, { signal }));
    form?.querySelectorAll<HTMLInputElement>('[data-provider-section] input[type="checkbox"]').forEach((toggle) => toggle.addEventListener('change', () => {
      const section = toggle.closest('fieldset')?.querySelector<HTMLElement>('[data-provider-section]');
      if (section) section.hidden = !toggle.checked;
      refreshPreview();
    }, { signal }));
    form?.querySelectorAll<HTMLButtonElement>('[data-provider-tab]').forEach((tab) => tab.addEventListener('click', () => {
      const active = tab.dataset.providerTab;
      form.querySelectorAll<HTMLButtonElement>('[data-provider-tab]').forEach((item) => {
        const selected = item === tab;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-selected', String(selected));
      });
      if (providerSettings) providerSettings.hidden = active !== 'settings';
      if (yamlPreview) yamlPreview.hidden = active !== 'yaml';
    }, { signal }));
    generateButton?.addEventListener('click', () => {
      const uri = input?.value.trim() ?? '';
      if (!editor || !uri) return;
      try {
        const current = editor.state.doc.toString();
        const generated = generateConfigForCore(uri, 'mihomo', current);
        if (generated.type === 'proxy-provider') {
          const name = nextMihomoProviderName(current);
          const nameInput = setting<HTMLInputElement>('providerName');
          if (nameInput) nameInput.value = name;
          const urlInput = setting<HTMLInputElement>('subscriptionUrl');
          if (urlInput) urlInput.value = uri;
          const hwidInput = setting<HTMLInputElement>('hwid');
          if (hwidInput && !hwidInput.value) hwidInput.value = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
          if (providerEditor) providerEditor.hidden = false;
          const providers = parseDocument(current, { uniqueKeys: true, version: '1.2' }).get('proxy-providers', true);
          const target = setting<HTMLSelectElement>('replaceTarget');
          if (target) {
            target.innerHTML = '<option value="">Выберите провайдера</option>';
            if (isMap(providers)) providers.items.forEach((pair) => {
              const option = document.createElement('option');
              const key = (pair as { key?: { toJSON?: () => unknown } }).key;
              option.value = String(key?.toJSON?.() ?? key ?? '');
              option.textContent = option.value;
              target.append(option);
            });
          }
          const replaceButton = form?.querySelector<HTMLButtonElement>('[data-provider-open-replace]');
          if (replaceButton) {
            replaceButton.disabled = !isMap(providers) || providers.items.length === 0;
            replaceButton.title = replaceButton.disabled ? 'В конфигурации пока нет провайдеров для замены' : 'Заменить существующий провайдер';
          }
          if (providerGroups) {
            providerGroups.replaceChildren();
            const groupDocument = parseDocument(current, { uniqueKeys: true, version: '1.2' });
            const groups = groupDocument.get('proxy-groups', true);
            if (!groupDocument.errors.length && isSeq(groups)) {
              for (const group of groups.items) {
                if (!isMap(group)) continue;
                const groupName = String(group.get('name', true)?.toJSON() ?? '');
                if (!groupName) continue;
                const label = document.createElement('label');
                label.className = 'proxy-provider-group-option';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.providerGroup = groupName;
                checkbox.value = groupName;
                const name = document.createElement('span');
                name.textContent = groupName;
                label.append(checkbox, name);
                providerGroups.append(label);
              }
            }
            if (!providerGroups.childElementCount) {
              const empty = document.createElement('span');
              empty.className = 'proxy-provider-hint';
              empty.textContent = 'В конфигурации не найдены группы прокси. Создайте proxy-groups и повторите импорт.';
              providerGroups.append(empty);
            }
          }
          refreshPreview();
          providerEditor?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        if (generated.type !== 'proxy') throw new Error('Для этого типа ссылки нет генератора Mihomo.');
        const updated = appendMihomoProxy(current, generated.content);
        enableEditorEditing();
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
        editor.focus();
        setValidation('Прокси добавлен в локальный черновик. Проверьте конфигурацию перед применением.', true);
        close();
      } catch (cause) {
        if (error) { error.hidden = false; error.textContent = cause instanceof Error ? cause.message : 'Не удалось обработать эту ссылку.'; }
      }
    }, { signal });
    form?.querySelectorAll<HTMLButtonElement>('[data-provider-insert]').forEach((button) => button.addEventListener('click', async () => {
      if (!editor) return;
      const position = button.dataset.providerInsert as MihomoProviderPosition;
      const replaceTarget = setting<HTMLSelectElement>('replaceTarget')?.value;
      if (position === 'replace' && !replaceTarget) {
        if (error) { error.hidden = false; error.textContent = 'Выберите провайдера для замены.'; }
        return;
      }
      if (position === 'replace' && !(await confirmInApp('Заменить провайдера?', `Параметры провайдера «${replaceTarget}» в локальном черновике будут заменены.`, 'Заменить'))) return;
      try {
        const current = editor.state.doc.toString();
        const content = createMihomoProviderYaml(settingsValue());
        const targetGroups = [...(providerGroups?.querySelectorAll<HTMLInputElement>('[data-provider-group]:checked') ?? [])].map((checkbox) => checkbox.value);
        if (!targetGroups.length) throw new Error('Выберите хотя бы одну группу, в которой нужно показать узлы подписки.');
        const updated = insertMihomoProvider(current, content, position, replaceTarget, targetGroups);
        enableEditorEditing();
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
        editor.focus();
        setValidation(`Провайдер подписки ${position === 'replace' ? 'заменён' : 'добавлен'} в локальный черновик. Проверьте конфигурацию перед применением.`, true);
        close();
      } catch (cause) {
        if (error) { error.hidden = false; error.textContent = cause instanceof Error ? cause.message : 'Не удалось обновить черновик.'; }
      }
    }, { signal }));
    form?.querySelector<HTMLButtonElement>('[data-provider-open-replace]')?.addEventListener('click', () => {
      const panel = form.querySelector<HTMLElement>('.proxy-provider-replace');
      if (panel) panel.hidden = false;
      setting<HTMLSelectElement>('replaceTarget')?.focus();
    }, { signal });
    dialog.addEventListener('click', (clickEvent) => { if (clickEvent.target === dialog) close(); }, { signal });
    dialog.showModal();
    input?.focus();
  }, { signal });
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--editor-text, #e1e9f8)', backgroundColor: 'var(--editor-bg, #080e1b)', fontSize: '14px', fontWeight: '500' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: '1.6' },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--editor-caret, #65c9ff)' },
  '.cm-gutters': { color: 'var(--editor-gutter-text, #566a88)', backgroundColor: 'var(--editor-gutter-bg, #0a1120)', borderRight: '1px solid var(--editor-border, #1e2b40)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line, #111e31)' },
  '.cm-activeLineGutter': { color: 'var(--editor-active-gutter, #9ab4d7)', backgroundColor: 'var(--editor-active-line, #111e31)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--editor-caret, #65c9ff)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--editor-selection, #244775) !important' },
});

const editorHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--editor-property, #62a8ff)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--editor-string, #9cda78)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--editor-number, #ff9b55)' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'var(--editor-atom, #d58bff)' },
  { tag: tags.comment, color: 'var(--editor-comment, #777ca7)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket], color: 'var(--editor-punctuation, #a8bad4)' },
  { tag: [tags.keyword, tags.operator], color: 'var(--editor-keyword, #68c9e8)' },
]);

function editorElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#yaml-editor');
}

function enableEditorEditing(): void {
  if (!editor || editorEditing) return;
  editorEditing = true;
  editor.dispatch({ effects: [editorReadOnly.reconfigure(EditorState.readOnly.of(false)), editorEditable.reconfigure(EditorView.editable.of(true))] });
  editor.focus();
}

function setValidation(message: string, valid: boolean | null): void {
  const status = document.querySelector<HTMLElement>('#yaml-validation');
  if (!status) return;
  status.className = `editor-validation${valid === null ? '' : valid ? ' is-valid' : ' is-invalid'}`;
  status.textContent = message;
  if (valid === false) {
    const source = message.startsWith('Ошибка YAML') ? 'yaml' : 'config';
    const key = `${source}\u0000${message}`;
    if (key !== lastLoggedValidationError) {
      lastLoggedValidationError = key;
      void logUiError(source, message).catch(() => undefined);
    }
  } else if (valid === true) lastLoggedValidationError = null;
}

function validateYaml(text: string): boolean {
  if (!text.trim()) {
    setValidation('Черновик пуст. Можно вставить шаблон или начать ввод.', null);
    return false;
  }
  const document = parseDocument(text, { uniqueKeys: true, version: '1.2' });
  const firstError = document.errors[0];
  if (firstError) {
    const position = firstError.linePos?.[0];
    const where = position ? ` · строка ${position.line}, столбец ${position.col}` : '';
    setValidation(`Ошибка YAML${where}: ${firstError.message}`, false);
    return false;
  }
  const rootValue: unknown = document.toJS();
  if (!rootValue || typeof rootValue !== 'object' || Array.isArray(rootValue)) {
    setValidation('YAML синтаксически корректен, но корнем документа ожидается объект Mihomo.', false);
    return false;
  }
  setValidation('✓ YAML валиден', true);
  return true;
}

function validateStructuredDocument(text: string): boolean {
  const format = currentFile().format;
  if (format === 'yaml') return validateYaml(text);
  if (format === 'text') {
    setValidation('Для этого списка синтаксический валидатор не задан.', null);
    return false;
  }
  if (!text.trim()) {
    setValidation('Черновик пуст.', null);
    return false;
  }
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, {
    allowTrailingComma: format === 'jsonc',
    disallowComments: format === 'json',
  });
  if (errors.length && errors[0]) {
    const error = errors[0];
    const line = text.slice(0, error.offset).split('\n').length;
    setValidation(`Ошибка ${format.toUpperCase()} · строка ${line}: ${printParseErrorCode(error.error)}`, false);
    return false;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    setValidation(`${format.toUpperCase()} синтаксически корректен, но ожидается корневой объект.`, false);
    return false;
  }
  setValidation(`✓ ${format.toUpperCase()} валиден · проверка Xray при применении`, true);
  return true;
}

export function unmountYamlEditor(): void {
  editorBindings?.abort();
  editorBindings = null;
  editor?.destroy();
  editor = null;
}

export function mountYamlEditor(routerMode = false, activeCore: 'mihomo' | 'xray' | null = 'mihomo'): void {
  const parent = editorElement();
  if (!parent) return;
  if (activeCore === 'xray' && activeFile === 'config') activeFile = 'xray_json';
  if (activeCore !== 'xray' && activeFile.startsWith('xray_')) activeFile = 'config';
  unmountYamlEditor();
  editorBindings = new AbortController();
  const { signal } = editorBindings;
  const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
  if (applyButton) applyButton.disabled = currentSnapshot() === null;
  const saveButton = document.querySelector<HTMLButtonElement>('#config-save-active');
  if (saveButton) saveButton.disabled = currentSnapshot() === null;

  mountUsefulLinksMenu();
  const utilityMenu = document.querySelector<HTMLElement>('.editor-utilities-menu');
  const backupsButton = document.querySelector<HTMLElement>('#yaml-backups');
  if (utilityMenu && backupsButton) utilityMenu.append(backupsButton);
  setEditorIdentity(routerMode, activeCore);
  editorEditing = false;
  editorReadOnly = new Compartment();
  editorEditable = new Compartment();
  parent.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.cm-content')) enableEditorEditing();
  }, { signal });
  bindAddProxyDialog(signal);
  bindAmneziaImportDialog(signal);
  bindConfigBackups(signal);
  document.querySelector<HTMLButtonElement>('#config-format-active')?.addEventListener('click', () => {
    if (!editor) return;
    try {
      const content = editor.state.doc.toString();
      const formatted = formatConfigContent(content, currentFile().format);
      if (formatted === content) return;
      enableEditorEditing();
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: formatted } });
      editor.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось отформатировать файл';
      setValidation(`Форматирование не выполнено: ${message}`, false);
    }
  }, { signal });
  const file = currentFile();
  const storedDraft = sessionStorage.getItem(`${draftKey}${file.id}`);
  const startWithRouterFile = routerMode && (file.id === 'config' || isRouterConfigFile(file.id) || isXrayConfigFile(file.id));
  // A saved browser draft from an earlier visit must not hide the actual router file.
  // Preserve in-session edits only after this editor has read a router snapshot.
  const hasRouterSnapshot = currentSnapshot() !== null;
  const template = !startWithRouterFile && (file.id === 'config' || file.id === 'xray_routing')
    ? getDefaultTemplate(file.id === 'config' ? 'mihomo' : 'xray').content : '';
  const initial = startWithRouterFile && !hasRouterSnapshot ? '' : storedDraft ?? template;
  if (storedDraft === null && initial) sessionStorage.setItem(`${draftKey}${file.id}`, initial);
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const text = update.state.doc.toString();
    sessionStorage.setItem(`${draftKey}${file.id}`, text);
    currentDocumentValid = file.format === 'text' ? true : validateStructuredDocument(text);
    syncConfigActions(text);
  });
  editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        ...(file.format === 'yaml' ? [yaml()] : file.format === 'text' ? [] : [json()]),
        syntaxHighlighting(editorHighlight),
        editorReadOnly.of(EditorState.readOnly.of(true)),
        editorEditable.of(EditorView.editable.of(false)),
        editorTheme,
        updateListener,
      ],
    }),
  });
  if (initial.trim()) currentDocumentValid = file.format === 'text' ? true : validateStructuredDocument(initial);
  else {
    currentDocumentValid = file.format === 'text';
    setValidation(file.format === 'yaml' ? 'Начните редактирование YAML-конфигурации' : 'Локальный файл пуст.', null);
  }
  syncConfigActions(initial);

  document.querySelectorAll<HTMLButtonElement>('[data-config-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFile = button.dataset.configFile;
      if (!nextFile || !draftFiles.some((candidate) => candidate.id === nextFile)) return;
      activeFile = nextFile;
      sessionStorage.setItem(activeFileKey, activeFile);
      mountYamlEditor(routerMode, activeCore);
      const activeEditor = document.querySelector<HTMLElement>('#yaml-editor .cm-content');
      activeEditor?.focus();
    }, { signal });
  });

  document.querySelector<HTMLButtonElement>('#yaml-template')?.addEventListener('click', async (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const file = currentFile();
    if (!editor || (file.format !== 'yaml' && file.format !== 'json' && file.format !== 'jsonc')) return;
    const requestedEditor = editor;
    void chooseReferenceTemplate(file.format === 'yaml' ? 'mihomo' : 'xray').then(async (template) => {
      if (!template || !editor) return;
      const targetId = file.format === 'yaml' ? 'config' : getXrayTemplateTarget(template.name);
      if (!targetId) throw new Error('Не удалось определить файл для шаблона Xray');
      const target = draftFiles.find((candidate) => candidate.id === targetId);
      if (!target) throw new Error('Файл для шаблона не найден в редакторе');
      let targetContent = targetId === file.id ? editor.state.doc.toString() : sessionStorage.getItem(`${draftKey}${targetId}`) ?? '';
      if (routerMode && isXrayConfigFile(targetId)) {
        const active = await getXrayConfigFile(xrayApiFile(targetId), signal);
        xraySnapshots.set(xrayApiFile(targetId), active.content);
        if (targetId !== file.id && !sessionStorage.getItem(`${draftKey}${targetId}`)) targetContent = active.content;
      }
      if (editor !== requestedEditor) return;
      if (targetContent.trim() && !(await confirmInApp('Заменить текущий черновик?', `Шаблон «${template.name}» загрузится в ${target.filename}. Текущий текст останется только в истории отмены до закрытия вкладки.`, 'Импортировать'))) return;
      if (targetId !== file.id) {
        activeFile = targetId;
        sessionStorage.setItem(activeFileKey, targetId);
        setEditorIdentity(routerMode, activeCore);
      }
      enableEditorEditing();
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: template.content } });
      editor.focus();
      validateStructuredDocument(template.content);
      const status = document.querySelector<HTMLElement>('#yaml-validation');
      if (status) status.textContent = `Шаблон «${template.name}» загружен в локальный черновик; перед использованием проверьте его совместимость.`;
    }).catch((error: unknown) => {
      setValidation(error instanceof Error ? `Не удалось открыть каталог: ${error.message}` : 'Не удалось открыть каталог шаблонов.', false);
    });
  }, { signal });
  document.querySelector<HTMLButtonElement>('#config-apply-active')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const fileId = currentFile().id;
    if (!editor || (fileId !== 'config' && !isXrayConfigFile(fileId)) || button.disabled) return;
    const requestedEditor = editor;
    const content = editor.state.doc.toString();
    const expectedContent = currentSnapshot();
    if (expectedContent === null) {
      setValidation('Файл ещё загружается с роутера. Повторите действие через секунду.', false);
      return;
    }
    if (!validateStructuredDocument(content)) return;
    currentDocumentValid = true;
    configActionBusy = true;
    syncConfigActions(content);
    button.disabled = true;
    const saveButton = document.querySelector<HTMLButtonElement>('#config-save-active');
    if (saveButton) saveButton.disabled = true;
    button.textContent = 'Проверка и перезапуск…';
    try {
      const apiFile = xrayApiFile(fileId);
      const normalized = fileId === 'xray_routing' ? JSON.stringify(parseJsonc(content, []), null, 2) : content;
      await runConfigApply(fileId === 'config' ? 'mihomo' : 'xray', () => fileId === 'config'
        ? applyActiveMihomoConfig(normalized, expectedContent, signal)
        : applyXrayConfigFile(apiFile, normalized, expectedContent, signal));
      if (editor !== requestedEditor || currentFile().id !== fileId) return;
      const draftUnchanged = editor.state.doc.toString() === content;
      if (draftUnchanged && normalized !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: normalized } });
      if (fileId === 'config') activeConfigSnapshot = normalized;
      else xraySnapshots.set(apiFile, normalized);
      if (draftUnchanged) setValidation(fileId === 'config' ? 'YAML полностью валиден' : `${fileId === 'xray_routing' ? 'JSONC' : 'JSON'} полностью валиден`, true);
      else currentDocumentValid = validateStructuredDocument(editor.state.doc.toString());
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 409')) {
        if (fileId === 'config') activeConfigSnapshot = null;
        else xraySnapshots.delete(xrayApiFile(fileId));
      }
      setValidation(error instanceof Error ? `Применение не выполнено: ${error.message}` : 'Применение конфигурации завершилось ошибкой.', false);
    } finally {
      configActionBusy = false;
      syncConfigActions(editor?.state.doc.toString() ?? '', currentDocumentValid);
      button.textContent = 'Применить и перезапустить';
    }
  }, { signal });

  document.querySelector<HTMLButtonElement>('#config-save-active')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const fileId = currentFile().id;
    if (!editor || (!isRouterConfigFile(fileId) && fileId !== 'config' && !isXrayConfigFile(fileId)) || button.disabled) return;
    const requestedEditor = editor;
    const expectedContent = currentSnapshot();
    if (expectedContent === null) { setValidation('Файл ещё загружается с роутера. Повторите действие через секунду.', false); return; }
    const rawContent = editor.state.doc.toString();
    const isStructured = !isRouterConfigFile(fileId) || fileId === 'xkeen';
    if (isStructured && !validateStructuredDocument(rawContent)) return;
    currentDocumentValid = true;
    const apiFile = isXrayConfigFile(fileId) ? xrayApiFile(fileId) : null;
    const content = fileId === 'xray_routing' ? JSON.stringify(parseJsonc(rawContent, []), null, 2) : rawContent;
    configActionBusy = true;
    syncConfigActions(rawContent);
    button.disabled = true;
    const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
    if (applyButton) applyButton.disabled = true;
    button.textContent = 'Сохраняем…';
    try {
      const result = fileId === 'config'
        ? await saveActiveMihomoConfig(content, expectedContent, signal)
        : apiFile ? await saveXrayConfigFile(apiFile, content, expectedContent)
          : await saveRouterConfigFile(fileId as RouterConfigFile, content, expectedContent);
      if (editor !== requestedEditor || currentFile().id !== fileId) return;
      if (content !== rawContent) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
      if (fileId === 'config') activeConfigSnapshot = content;
      else if (apiFile) xraySnapshots.set(apiFile, content);
      else listSnapshots.set(fileId as RouterConfigFile, content);
      setValidation(`✓ Сохранено. ${result.path}. Резервная копия: ${result.backup}`, true);
    } catch (error) {
      setValidation(error instanceof Error ? `Сохранение не выполнено: ${error.message}` : 'Сохранение завершилось ошибкой.', false);
    } finally {
      configActionBusy = false;
      syncConfigActions(editor?.state.doc.toString() ?? '', currentDocumentValid);
      button.textContent = 'Сохранить';
    }
  }, { signal });

  if (startWithRouterFile && !hasRouterSnapshot) {
    const requestedEditor = editor;
    setValidation(`Считываем ${file.filename} с роутера…`, null);
    const loaded = file.id === 'config' ? getActiveMihomoConfig(signal)
      : isXrayConfigFile(file.id) ? getXrayConfigFile(xrayApiFile(file.id), signal)
        : getRouterConfigFile(file.id as RouterConfigFile, signal);
    void loaded.then((active) => {
      if (editor !== requestedEditor || !editor || editor.state.doc.length) return;
      editor.dispatch({ changes: { from: 0, to: 0, insert: active.content } });
      if (file.id === 'config') activeConfigSnapshot = active.content;
      else if (isXrayConfigFile(file.id)) xraySnapshots.set(xrayApiFile(file.id), active.content);
      else listSnapshots.set(file.id as RouterConfigFile, active.content);
      currentDocumentValid = file.format === 'text' ? true : validateStructuredDocument(active.content);
      syncConfigActions(active.content);
    }).catch((error: unknown) => {
      if (!signal.aborted) setValidation(error instanceof Error ? `Не удалось считать ${file.filename}: ${error.message}` : `Не удалось считать ${file.filename}.`, false);
    });
  }
}
