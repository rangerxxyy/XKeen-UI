import { isSeq, parseDocument } from 'yaml';

/** Append a generated YAML sequence item to config.yaml while retaining unrelated document content. */
export function appendMihomoProxy(source: string, generatedProxy: string): string {
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length) throw new Error(`Текущий YAML содержит ошибку: ${document.errors[0]?.message ?? 'неизвестная ошибка'}`);
  if (!document.contents || !('get' in document.contents)) throw new Error('Ожидается YAML-объект конфигурации Mihomo');

  const generatedDocument = parseDocument(`proxies:\n${generatedProxy}`, { uniqueKeys: true, version: '1.2' });
  if (generatedDocument.errors.length) throw new Error('Не удалось прочитать созданный блок прокси');
  const incoming = generatedDocument.get('proxies', true);
  if (!isSeq(incoming) || incoming.items.length === 0) throw new Error('Ссылка не создала запись прокси');

  const existing = document.get('proxies', true);
  if (existing !== undefined && !isSeq(existing)) throw new Error('Поле proxies в конфигурации должно быть списком');
  const sequence = isSeq(existing) ? existing : document.createNode([]);
  if (!isSeq(sequence)) throw new Error('Не удалось создать список прокси');
  if (!isSeq(existing)) document.set('proxies', sequence);

  for (const item of incoming.items) {
    const value = (item as { toJSON(): unknown }).toJSON();
    sequence.add(document.createNode(value));
  }
  return document.toString({ indent: 2, lineWidth: 0 });
}
