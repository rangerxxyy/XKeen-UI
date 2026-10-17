import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { applyEdits, format as formatJsonc, parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { chooseReferenceTemplate, getDefaultTemplate } from './templates';
import { applyActiveMihomoConfig, applyXrayConfigFile, getActiveMihomoConfig, getRouterConfigFile, getXrayConfigFile, logUiError, saveActiveMihomoConfig, saveRouterConfigFile, saveXrayConfigFile, type RouterConfigFile, type XrayConfigFile } from './api';
import { confirmInApp } from './confirm-dialog';
import { canPersistConfig } from './config-actions';
import { generateConfigForCore } from './outbound-parser';
import { appendMihomoProxy } from './proxy-import';

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
  const hint = document.querySelector<HTMLElement>('#editor-file-hint');
  if (filename) filename.textContent = file.filename;
  if (language) language.textContent = file.format === 'yaml' ? 'YAML · Mihomo' : file.format === 'text' ? 'TEXT · XKeen' : `${file.format.toUpperCase()} · ${file.id === 'xkeen' ? 'XKeen' : 'Xray'}`;
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
    dialog.innerHTML = '<form class="modal-panel" method="dialog" id="proxy-import-form"><div class="modal-heading"><span class="modal-icon" aria-hidden="true">↗</span><h2>Добавить прокси</h2><button class="icon-button" type="button" data-close-proxy-import aria-label="Закрыть">×</button></div><p class="modal-note">Вставьте ссылку на узел. Прокси добавится в локальный черновик конфигурации Mihomo.</p><label class="proxy-import-field"><span>Ссылка на подключение</span><input name="uri" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="vless://…" required></label><p class="proxy-import-error" role="alert" hidden></p><div class="confirmation-actions"><button class="editor-button" type="button" data-close-proxy-import>Отмена</button><button class="editor-button editor-button-primary" type="submit">Добавить прокси</button></div></form>';
    document.body.append(dialog);
    const form = dialog.querySelector<HTMLFormElement>('#proxy-import-form');
    const input = form?.querySelector<HTMLInputElement>('[name="uri"]');
    const error = form?.querySelector<HTMLElement>('.proxy-import-error');
    const close = () => { if (dialog.open) dialog.close(); else dialog.remove(); };
    signal.addEventListener('abort', close, { once: true });
    dialog.querySelectorAll<HTMLButtonElement>('[data-close-proxy-import]').forEach((button) => button.addEventListener('click', close, { signal }));
    dialog.addEventListener('close', () => dialog.remove(), { once: true, signal });
    form?.addEventListener('submit', (submitEvent) => {
      submitEvent.preventDefault();
      const uri = input?.value.trim() ?? '';
      if (!editor || !uri) return;
      try {
        const current = editor.state.doc.toString();
        const generated = generateConfigForCore(uri, 'mihomo', current);
        if (generated.type !== 'proxy') throw new Error('Для добавления прокси вставьте ссылку на отдельный узел, а не URL подписки.');
        const updated = appendMihomoProxy(current, generated.content);
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
        editor.focus();
        setValidation('Прокси добавлен в локальный черновик. Проверьте конфигурацию перед применением.', true);
        close();
      } catch (cause) {
        if (error) {
          error.hidden = false;
          error.textContent = cause instanceof Error ? cause.message : 'Не удалось добавить прокси из этой ссылки.';
        }
      }
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
      const result = fileId === 'config'
        ? await applyActiveMihomoConfig(normalized, expectedContent, signal)
        : await applyXrayConfigFile(apiFile, normalized, expectedContent, signal);
      if (editor !== requestedEditor || currentFile().id !== fileId) return;
      if (normalized !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: normalized } });
      if (fileId === 'config') activeConfigSnapshot = normalized;
      else xraySnapshots.set(apiFile, normalized);
      const hint = document.querySelector<HTMLElement>('#editor-file-hint');
      if (hint) hint.textContent = `Файл на роутере · ${result.path}`;
      setValidation(`✓ ${result.detail}. Резервная копия: ${result.backup}`, true);
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
