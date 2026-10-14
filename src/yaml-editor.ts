import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { parseDocument } from 'yaml';

const draftKey = 'xkeen-ui:draft:mihomo-yaml';
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
  const blob = new Blob([text], { type: 'application/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mihomo-draft.yaml';
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

  const initial = sessionStorage.getItem(draftKey) ?? '';
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const text = update.state.doc.toString();
    sessionStorage.setItem(draftKey, text);
    setValidation(`Черновик в этой вкладке · ${update.state.doc.lines} строк · не применён`, null);
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
        yaml(),
        syntaxHighlighting(defaultHighlightStyle),
        editorTheme,
        EditorView.lineWrapping,
        updateListener,
      ],
    }),
  });
  setValidation(initial.trim() ? `Черновик в этой вкладке · ${editor.state.doc.lines} строк · не применён` : 'Черновик пуст. Можно вставить шаблон или начать ввод.', null);

  document.querySelector<HTMLButtonElement>('#yaml-validate')?.addEventListener('click', () => {
    if (editor) validateYaml(editor.state.doc.toString());
  });
  document.querySelector<HTMLButtonElement>('#yaml-format')?.addEventListener('click', () => {
    if (!editor) return;
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
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current.trim() && !window.confirm('Заменить текущий черновик примером? Текст текущего черновика будет заменён.')) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: starterTemplate } });
    editor.focus();
  });
  document.querySelector<HTMLButtonElement>('#yaml-download')?.addEventListener('click', () => {
    if (editor) downloadDraft(editor.state.doc.toString());
  });
}
