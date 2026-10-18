import type { MihomoConnection } from './api';
import { formatBytes } from './mihomo-view';

function escape(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

export function renderConnectionDetails(connection: MihomoConnection, sourceName?: string): string {
  const startedAt = new Date(connection.start);
  const start = Number.isFinite(startedAt.getTime())
    ? startedAt.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'medium' }) : '';
  const rows = [
    ['Хост', connection.host],
    ['Адрес назначения', connection.destination],
    ...(sourceName ? [['Устройство', sourceName]] : []),
    ['Адрес источника', connection.source],
    ['Протокол', connection.network.toUpperCase()],
    ['Процесс', connection.process],
    ['Цепочка', [...connection.chains].reverse().join(' → ')],
    ['Правило', connection.rule],
    ['Условие правила', connection.rulePayload],
    ['Начало соединения', start],
    ['ID', connection.id],
  ];
  return `<p class="modal-note">Данные на момент открытия. Соединение могло уже завершиться.</p>
    <div class="connection-detail-traffic"><div><span>Передано</span><strong>${formatBytes(connection.upload)}</strong></div><div><span>Получено</span><strong>${formatBytes(connection.download)}</strong></div></div>
    <dl class="connection-detail-list">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value ? escape(value) : '<span class="connection-detail-missing">Не передано ядром</span>'}</dd></div>`).join('')}</dl>`;
}
