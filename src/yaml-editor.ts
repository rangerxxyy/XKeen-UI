import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { applyEdits, format as formatJsonc, parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { chooseReferenceTemplate, getDefaultTemplate } from './templates';
import { applyActiveMihomoConfig, getActiveMihomoConfig } from './api';

const draftKey = 'xkeen-ui:draft:';
const activeFileKey = 'xkeen-ui:draft-active-file';
const draftFiles = [
  { id: 'config', label: 'config', filename: 'config.yaml', format: 'yaml' },
  { id: 'ip_exclude', label: 'ip_exclude', filename: 'ip_exclude', format: 'text' },
  { id: 'port_exclude', label: 'port_exclude', filename: 'port_exclude', format: 'text' },
  { id: 'port_proxying', label: 'port_proxying', filename: 'port_proxying', format: 'text' },
  { id: 'xkeen', label: 'xkeen', filename: 'xkeen', format: 'text' },
  { id: 'xray_json', label: 'xray_config.json', filename: 'config.json', format: 'json' },
  { id: 'xray_jsonc', label: '05_routing.jsonc', filename: '05_routing.jsonc', format: 'jsonc' },
] as const;
let editor: EditorView | null = null;
let activeFile = sessionStorage.getItem(activeFileKey) ?? 'config';
let activeConfigSnapshot: string | null = null;

function currentFile() {
  return draftFiles.find((file) => file.id === activeFile) ?? draftFiles[0];
}

function setEditorIdentity(): void {
  const file = currentFile();
  const filename = document.querySelector<HTMLElement>('#editor-filename');
  const language = document.querySelector<HTMLElement>('#editor-language');
  const hint = document.querySelector<HTMLElement>('#editor-file-hint');
  if (filename) filename.textContent = file.filename;
  if (language) language.textContent = file.format === 'yaml' ? 'YAML · Mihomo' : file.format === 'text' ? 'TEXT · XKeen' : `${file.format.toUpperCase()} · Xray`;
  if (hint) hint.textContent = file.format === 'yaml' ? 'Локальная вкладка · не файл роутера' : 'Локальный черновик · не файл роутера';
  document.querySelectorAll<HTMLButtonElement>('[data-config-file]').forEach((button) => {
    const selected = button.dataset.configFile === file.id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll<HTMLElement>('[data-yaml-only]').forEach((element) => {
    element.hidden = file.format !== 'yaml';
  });
  document.querySelectorAll<HTMLElement>('[data-structured-only]').forEach((element) => {
    element.hidden = file.format === 'text';
  });
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#d9e4f5', backgroundColor: '#080e1b' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: '1.65' },
  '.cm-content': { padding: '14px 0', caretColor: '#65c9ff' },
  '.cm-gutters': { color: '#566a88', backgroundColor: '#0a1120', borderRight: '1px solid #1e2b40' },
  '.cm-activeLine': { backgroundColor: '#111e31' },
  '.cm-activeLineGutter': { color: '#9ab4d7', backgroundColor: '#111e31' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#65c9ff' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#244775 !important' },
});

function editorElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#yaml-editor');
}

function setValidation(message: string, valid: boolean | null): void {
  const status = document.querySelector<HTMLElement>('#yaml-validation');
  if (!status) return;
  status.className = `editor-validation${valid === null ? '' : valid ? ' is-valid' : ' is-invalid'}`;
  status.textContent = message;
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
  setValidation('YAML синтаксически корректен. Совместимость со схемой ядра ещё не проверена.', true);
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
    setValidation(`${format.toUpperCase()} синтаксически корректен, но ожидается корневой объект Xray.`, false);
    return false;
  }
  setValidation(`${format.toUpperCase()} синтаксически корректен. Схема версии Xray не проверялась.`, true);
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
  editor?.destroy();
  editor = null;
}

export function mountYamlEditor(): void {
  const parent = editorElement();
  if (!parent) return;
  unmountYamlEditor();
  activeConfigSnapshot = null;
  const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
  if (applyButton) applyButton.disabled = true;

  setEditorIdentity();
  const file = currentFile();
  const storedDraft = sessionStorage.getItem(`${draftKey}${file.id}`);
  const initial = storedDraft ?? (file.id === 'config' || file.id === 'xray_jsonc' ? getDefaultTemplate(file.id === 'config' ? 'mihomo' : 'xray').content : '');
  if (storedDraft === null && initial) sessionStorage.setItem(`${draftKey}${file.id}`, initial);
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const text = update.state.doc.toString();
    sessionStorage.setItem(`${draftKey}${file.id}`, text);
    setValidation(`Черновик ${file.filename} · ${update.state.doc.lines} строк · не применён`, null);
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
        syntaxHighlighting(defaultHighlightStyle),
        editorTheme,
        EditorView.lineWrapping,
        updateListener,
      ],
    }),
  });
  setValidation(initial.trim()
    ? `Черновик ${file.filename} · ${editor.state.doc.lines} строк · не применён`
    : file.format === 'yaml' ? 'Черновик пуст. Можно вставить шаблон или начать ввод.' : 'Локальный черновик пуст.', null);
  if (storedDraft === null && initial.trim()) {
    setValidation(file.format === 'yaml'
      ? 'Загружен локальный стартовый шаблон Mihomo «Только заблокированное»; это черновик.'
      : 'Загружен локальный шаблон Xray Routing «Только заблокированное»; это фрагмент конфигурации.', null);
  }

  document.querySelectorAll<HTMLButtonElement>('[data-config-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFile = button.dataset.configFile;
      if (!nextFile || !draftFiles.some((candidate) => candidate.id === nextFile)) return;
      activeFile = nextFile;
      sessionStorage.setItem(activeFileKey, activeFile);
      mountYamlEditor();
      const activeEditor = document.querySelector<HTMLElement>('#yaml-editor .cm-content');
      activeEditor?.focus();
    });
  });

  document.querySelector<HTMLButtonElement>('#yaml-validate')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    if (editor) validateStructuredDocument(editor.state.doc.toString());
  });
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
  });
  document.querySelector<HTMLButtonElement>('#yaml-template')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    const file = currentFile();
    if (!editor || (file.format !== 'yaml' && file.format !== 'json' && file.format !== 'jsonc')) return;
    const current = editor.state.doc.toString();
    if (current.trim() && !window.confirm('Загрузить шаблон вместо текущего черновика? Текущий текст останется только в истории undo до закрытия вкладки.')) return;
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
  });
  document.querySelector<HTMLButtonElement>('#yaml-download')?.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).closest('details')?.removeAttribute('open');
    if (editor) downloadDraft(editor.state.doc.toString());
  });
  document.querySelector<HTMLButtonElement>('#config-load-active')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!editor || currentFile().id !== 'config') return;
    const requestedEditor = editor;
    if (editor.state.doc.length && !window.confirm('Загрузить активный конфиг Mihomo с роутера вместо текущего текста редактора? На роутер ничего записываться не будет.')) return;
    button.disabled = true;
    button.textContent = 'Читаем…';
    try {
      const active = await getActiveMihomoConfig();
      if (editor !== requestedEditor || currentFile().id !== 'config') return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: active.content } });
      const hint = document.querySelector<HTMLElement>('#editor-file-hint');
      if (hint) hint.textContent = `Снимок с роутера · ${active.path}`;
      activeConfigSnapshot = active.content;
      const applyButton = document.querySelector<HTMLButtonElement>('#config-apply-active');
      if (applyButton) applyButton.disabled = false;
      validateStructuredDocument(active.content);
      setValidation(`Прочитан активный конфиг с роутера: ${active.path}.`, null);
    } catch (error) {
      setValidation(error instanceof Error ? `Не удалось прочитать конфиг: ${error.message}` : 'Не удалось прочитать конфиг роутера.', false);
    } finally {
      button.disabled = false;
      button.textContent = '↓ Считать конфиг роутера';
    }
  });
  document.querySelector<HTMLButtonElement>('#config-apply-active')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!editor || currentFile().id !== 'config' || button.disabled) return;
    const requestedEditor = editor;
    const content = editor.state.doc.toString();
    const expectedContent = activeConfigSnapshot;
    if (expectedContent === null) {
      setValidation('Считайте актуальный конфиг с роутера перед применением.', false);
      return;
    }
    if (!validateYaml(content)) return;
    if (!window.confirm('Применить этот конфиг к Mihomo на роутере? Ядро проверит файл перед заменой. Будет создана резервная копия; если перезапуск не подтвердится, backend попробует восстановить предыдущий конфиг.')) return;
    button.disabled = true;
    button.textContent = 'Проверка и запись…';
    try {
      const result = await applyActiveMihomoConfig(content, expectedContent);
      if (editor !== requestedEditor || currentFile().id !== 'config') return;
      activeConfigSnapshot = content;
      const hint = document.querySelector<HTMLElement>('#editor-file-hint');
      if (hint) hint.textContent = `Активный конфиг · ${result.path}`;
      setValidation(`${result.detail}. Резервная копия: ${result.backup}`, true);
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 409')) activeConfigSnapshot = null;
      setValidation(error instanceof Error ? `Применение не выполнено: ${error.message}` : 'Применение конфигурации завершилось ошибкой.', false);
    } finally {
      button.disabled = activeConfigSnapshot === null;
      button.textContent = 'Применить на роутер';
    }
  });
}
