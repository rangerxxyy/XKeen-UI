import { describe, expect, it } from 'vitest';
import { renderEditorUtilitiesMenu } from './editor-utilities';

describe('editor utilities menu', () => {
  it('keeps the four requested utilities in order and omits backups', () => {
    const markup = renderEditorUtilitiesMenu();
    const entries = [
      'Добавить прокси',
      'Шаблон конфигурации',
      'Импорт AmneziaWG',
      'Полезные ссылки',
    ];
    const positions = entries.map((entry) => markup.indexOf(entry));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).not.toContain('Резервные копии');
  });
});
