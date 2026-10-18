import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { applyEdits, format as formatJsonc, parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { isMap, parseDocument } from 'yaml';
import { chooseReferenceTemplate, getDefaultTemplate } from './templates';
import { applyActiveMihomoConfig, applyXrayConfigFile, getActiveMihomoConfig, getRouterConfigFile, getXrayConfigFile, logUiError, saveActiveMihomoConfig, saveRouterConfigFile, saveXrayConfigFile, type RouterConfigFile, type XrayConfigFile } from './api';
import { confirmInApp } from './confirm-dialog';
import { canPersistConfig, runConfigApply } from './config-actions';
import { generateConfigForCore } from './outbound-parser';
import { appendMihomoProxy } from './proxy-import';
import { createMihomoProviderYaml, insertMihomoProvider, nextMihomoProviderName, type MihomoProviderPosition, type MihomoProviderSettings } from './mihomo-provider';

const draftKey = 'xkeen-ui:draft:';
const activeFileKey = 'xkeen-ui:draft-active-file';
const draftFiles = [
  { id: 'config', label: 'config', filename: 'config.yaml', format: 'yaml' },
  { id: 'ip_exclude', label: 'ip_exclude', filename: 'ip_exclude.lst', format: 'text' },
  { id: 'port_exclude', label: 'port_exclude', filename: 'port_exclude.lst', format: 'text' },
  { id: 'port_proxying', label: 'port_proxying', filename: 'port_proxying.lst', format: 'text' },
  { id: 'xkeen', label: 'xkeen', filename: 'xkeen.json', format: 'json' },
  { id: 'xray_json', label: 'config', filename: '04_outbounds.json', format: 'json' },
  { id: 'xray_routing', label: 'routing', filename: '05_routing.json', format: 'jsonc' },
] as const;
let editor: EditorView | null = null;
let editorBindings: AbortController | null = null;
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
  return file === 'xray_json' || file === 'xray_routing';
}

function xrayApiFile(file: string): XrayConfigFile {
  return file === 'xray_json' ? 'xray_outbounds' : 'xray_routing';
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
}

function setEditorIdentity(routerMode: boolean, activeCore: 'mihomo' | 'xray' | null): void {
  const file = currentFile();
  const filename = document.querySelector<HTMLElement>('#editor-filename');
  const language = document.querySelector<HTMLElement>('#editor-language');
  const description = document.querySelector<HTMLElement>('#editor-file-description');
  const hint = document.querySelector<HTMLElement>('#editor-file-hint');
  if (filename) filename.textContent = file.filename;
  if (language) language.textContent = file.format === 'yaml' ? 'YAML · Mihomo' : file.format === 'text' ? 'TEXT · XKeen' : `${file.format.toUpperCase()} · ${file.id === 'xkeen' ? 'XKeen' : 'Xray'}`;
  const fileDescriptions: Record<string, string> = {
    config: 'Основные правила и параметры Mihomo', xray_json: 'Основные настройки ядра Xray', xray_routing: 'Правила маршрутизации и выбора outbound в Xray',
    ip_exclude: 'IP-адреса и подсети, которые XKeen пропускает мимо прокси',
    port_exclude: 'Порты, исключённые из обработки XKeen',
    port_proxying: 'Порты, трафик которых направляется через прокси',
    xkeen: 'Параметры запуска XKeen и системной маршрутизации',
  };
  if (description) description.textContent = fileDescriptions[file.id] ?? 'Файл конфигурации XKeen';
  if (hint) hint.textContent = 'Локальный черновик';
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
  document.querySelectorAll<HTMLElement>('[data-structured-only]').forEach((element) => {
    element.hidden = file.format === 'text';
  });
  const templateButton = document.querySelector<HTMLElement>('#yaml-template');
  if (templateButton) templateButton.hidden = file.id === 'xkeen' || file.format === 'text';
  const addProxyButton = document.querySelector<HTMLElement>('#yaml-add-proxy');
  if (addProxyButton) addProxyButton.hidden = file.id !== 'config' || activeCore !== 'mihomo';
}

function bindAddProxyDialog(signal: AbortSignal): void {
  document.querySelector<HTMLButtonElement>('#yaml-add-proxy')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const dialog = document.createElement('dialog');
    dialog.className = 'modal proxy-import-dialog';
    dialog.innerHTML = `<form class="modal-panel" method="dialog" id="proxy-import-form">
      <div class="modal-heading"><span class="modal-icon" aria-hidden="true">↗</span><h2>Добавить подключение</h2><button class="icon-button" type="button" data-close-proxy-import aria-label="Закрыть">×</button></div>
      <p class="modal-note">Вставьте ссылку на отдельный узел или URL подписки Mihomo. Изменения попадут только в локальный черновик.</p>
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
          refreshPreview();
          providerEditor?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        if (generated.type !== 'proxy') throw new Error('Для этого типа ссылки нет генератора Mihomo.');
        const updated = appendMihomoProxy(current, generated.content);
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
        const updated = insertMihomoProvider(current, content, position, replaceTarget);
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
  setValidation('✓ YAML валиден · проверка Mihomo при сохранении', true);
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

function downloadDraft(text: string): void {
  const file = currentFile();
  const mime = file.format === 'yaml' ? 'application/yaml;charset=utf-8'
    : file.format === 'json' || file.format === 'jsonc' ? 'application/json;charset=utf-8'
      : 'text/plain;charset=utf-8';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (activeCore !== 'xray' && (activeFile === 'xray_json' || activeFile === 'xray_routing')) activeFile = 'config';
  unmountYamlEditor();
  editorBindings = new AbortController();
  const { signal } = editorBindings;
  const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
  if (applyButton) applyButton.disabled = currentSnapshot() === null;
  const saveButton = document.querySelector<HTMLButtonElement>('#config-save-active');
  if (saveButton) saveButton.disabled = currentSnapshot() === null;

  setEditorIdentity(routerMode, activeCore);
  bindAddProxyDialog(signal);
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

  document.querySelector<HTMLButtonElement>('#yaml-validate')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    if (editor) validateStructuredDocument(editor.state.doc.toString());
  }, { signal });
  document.querySelector<HTMLButtonElement>('#yaml-format')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    if (!editor || currentFile().format === 'text') return;
    const source = editor.state.doc.toString();
    if (!validateStructuredDocument(source)) {
      return;
    }
    const file = currentFile();
    let formatted = source;
    if (file.format === 'yaml') {
      const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
      if (document.contents) formatted = document.toString({ indent: 2, lineWidth: 0 });
    } else {
      const edits = formatJsonc(source, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' });
      formatted = applyEdits(source, edits);
    }
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: formatted } });
    setValidation(`Форматирование ${file.format.toUpperCase()} выполнено; совместимость со схемой не проверялась.`, true);
  }, { signal });
  document.querySelector<HTMLButtonElement>('#yaml-template')?.addEventListener('click', async (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const file = currentFile();
    if (!editor || (file.format !== 'yaml' && file.format !== 'json' && file.format !== 'jsonc')) return;
    const current = editor.state.doc.toString();
    if (current.trim() && !(await confirmInApp('Заменить текущий черновик?', 'Шаблон загрузится в редактор. Текущий текст останется только в истории отмены до закрытия вкладки.', 'Загрузить шаблон'))) return;
    void chooseReferenceTemplate(file.format === 'yaml' ? 'mihomo' : 'xray').then((template) => {
      if (!template || !editor) return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: template.content } });
      editor.focus();
      validateStructuredDocument(template.content);
      const status = document.querySelector<HTMLElement>('#yaml-validation');
      if (status) status.textContent = `Шаблон «${template.name}» загружен в локальный черновик; перед использованием проверьте его совместимость.`;
    }).catch((error: unknown) => {
      setValidation(error instanceof Error ? `Не удалось открыть каталог: ${error.message}` : 'Не удалось открыть каталог шаблонов.', false);
    });
  }, { signal });
  document.querySelector<HTMLButtonElement>('#yaml-download')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    if (editor) downloadDraft(editor.state.doc.toString());
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
      const result = await runConfigApply(fileId === 'config' ? 'mihomo' : 'xray', () => fileId === 'config'
        ? applyActiveMihomoConfig(normalized, expectedContent, signal)
        : applyXrayConfigFile(apiFile, normalized, expectedContent, signal));
      if (editor !== requestedEditor || currentFile().id !== fileId) return;
      const draftUnchanged = editor.state.doc.toString() === content;
      if (draftUnchanged && normalized !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: normalized } });
      if (fileId === 'config') activeConfigSnapshot = normalized;
      else xraySnapshots.set(apiFile, normalized);
      const hint = document.querySelector<HTMLElement>('#editor-file-hint');
      if (hint) hint.textContent = `Файл на роутере · ${result.path}`;
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
      const hint = document.querySelector<HTMLElement>('#editor-file-hint');
      if (hint) hint.textContent = `Файл на роутере · ${result.path}`;
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
