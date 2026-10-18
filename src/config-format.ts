import { applyEdits, format as formatJsonc, parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parseDocument } from 'yaml';

export type ConfigFormat = 'yaml' | 'json' | 'jsonc' | 'text';

export function formatConfigContent(content: string, format: ConfigFormat): string {
  if (format === 'text' || !content.trim()) return content;
  if (format === 'yaml') {
    const document = parseDocument(content, { uniqueKeys: true, version: '1.2' });
    if (document.errors.length) throw new Error(document.errors[0]?.message ?? 'Некорректный YAML');
    return document.toString({ indent: 2 });
  }
  if (format === 'json') return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;

  const errors: ParseError[] = [];
  parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new Error('JSONC содержит синтаксическую ошибку');
  return applyEdits(content, formatJsonc(content, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }));
}
