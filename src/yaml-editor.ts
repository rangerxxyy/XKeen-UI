import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { parseDocument } from 'yaml';

const draftKey = 'xkeen-ui:draft:';
const activeFileKey = 'xkeen-ui:draft-active-file';
const draftFiles = [
  { id: 'config', label: 'config', filename: 'config.yaml', yaml: true },
  { id: 'ip_exclude', label: 'ip_exclude', filename: 'ip_exclude', yaml: false },
  { id: 'port_exclude', label: 'port_exclude', filename: 'port_exclude', yaml: false },
  { id: 'port_proxying', label: 'port_proxying', filename: 'port_proxying', yaml: false },
  { id: 'xkeen', label: 'xkeen', filename: 'xkeen', yaml: false },
] as const;
const starterTemplate = `# Локальный пример для изучения формата Mihomo.
# Этот черновик не связан с роутером и не применяется автоматически.
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090
proxies: []
proxy-groups: []
rules:
  - MATCH,DIRECT
`;

let editor: EditorView | null = null;
let activeFile = sessionStorage.getItem(activeFileKey) ?? 'config';

function currentFile() {
  return draftFiles.find((file) => file.id === activeFile) ?? draftFiles[0];
}

function setEditorIdentity(): void {
  const file = currentFile();
  const filename = document.querySelector<HTMLElement>('#editor-filename');
  const language = document.querySelector<HTMLElement>('#editor-language');
  const hint = document.querySelector<HTMLElement>('#editor-file-hint');
  if (filename) filename.textContent = file.filename;
  if (language) language.textContent = file.yaml ? 'YAML · Mihomo' : 'TEXT · XKeen';
  if (hint) hint.textContent = file.yaml ? 'Локальная вкладка · не файл роутера' : 'Локальный список · не файл роутера';
  document.querySelectorAll<HTMLButtonElement>('[data-config-file]').forEach((button) => {
    const selected = button.dataset.configFile === file.id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll<HTMLElement>('[data-yaml-only]').forEach((element) => {
    element.hidden = !file.yaml;
  });
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#d9e4f5', backgroundColor: '#080e1b' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: '1.65' },
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

function downloadDraft(text: string): void {
  const file = currentFile();
  const blob = new Blob([text], { type: file.yaml ? 'application/yaml;charset=utf-8' : 'text/plain;charset=utf-8' });
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

  setEditorIdentity();
  const file = currentFile();
  const initial = sessionStorage.getItem(`${draftKey}${file.id}`) ?? '';
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const text = update.state.doc.toString();
    sessionStorage.setItem(`${draftKey}${file.id}`, text);
    if (file.yaml) setValidation(`Черновик в этой вкладке · ${update.state.doc.lines} строк · не применён`, null);
    else setValidation(`Локальный текстовый список · ${update.state.doc.lines} строк · не применён`, null);
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
        ...(file.yaml ? [yaml()] : []),
        syntaxHighlighting(defaultHighlightStyle),
        editorTheme,
        EditorView.lineWrapping,
        updateListener,
      ],
    }),
  });
  setValidation(initial.trim()
    ? `${file.yaml ? 'Черновик' : 'Список'} в этой вкладке · ${editor.state.doc.lines} строк · не применён`
    : file.yaml ? 'Черновик пуст. Можно вставить шаблон или начать ввод.' : 'Локальный список пуст.', null);

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

  document.querySelector<HTMLButtonElement>('#yaml-validate')?.addEventListener('click', () => {
    if (editor) validateYaml(editor.state.doc.toString());
  });
  document.querySelector<HTMLButtonElement>('#yaml-format')?.addEventListener('click', () => {
    if (!editor || !currentFile().yaml) return;
    const source = editor.state.doc.toString();
    const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
    if (document.errors.length) {
      validateYaml(source);
      return;
    }
    if (document.contents) {
      const formatted = document.toString({ indent: 2, lineWidth: 0 });
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: formatted } });
      setValidation('Форматирование выполнено. Совместимость со схемой ядра не проверена.', true);
    }
  });
  document.querySelector<HTMLButtonElement>('#yaml-template')?.addEventListener('click', () => {
    if (!editor || !currentFile().yaml) return;
    const current = editor.state.doc.toString();
    if (current.trim() && !window.confirm('Заменить текущий черновик примером? Текст текущего черновика будет заменён.')) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: starterTemplate } });
    editor.focus();
  });
  document.querySelector<HTMLButtonElement>('#yaml-download')?.addEventListener('click', () => {
    if (editor) downloadDraft(editor.state.doc.toString());
  });
}
