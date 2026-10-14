import type { MihomoDnsResult } from './api';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

function formatAnswerCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'записей'
    : mod10 === 1 ? 'запись' : mod10 >= 2 && mod10 <= 4 ? 'записи' : 'записей';
  return `${count} ${noun}`;
}

export function renderDns(result: MihomoDnsResult | null, loading: boolean, error: string | null, queryName: string, queryType: string): string {
  const answers = result?.answers ?? [];
  const status = error
    ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Запрос не выполнен</strong><p>${escapeHtml(error)}</p></div></div>`
    : loading
      ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Проверяем DNS</strong><p>Ждём ответ локального Mihomo API.</p></div></div>'
      : result
        ? `<section class="dns-result"><header><div><span class="selector-kicker">ОТВЕТ MIHOMO</span><h2>${escapeHtml(result.status)}</h2></div><span class="dns-answer-count">${formatAnswerCount(answers.length)}</span></header>${answers.length ? `<div class="dns-record-list">${answers.map((answer) => `<article class="dns-record"><div><strong>${escapeHtml(answer.name)}</strong><span>${escapeHtml(answer.type)}</span></div><code>${escapeHtml(answer.data)}</code><small>${answer.ttl === null ? 'TTL не указан' : `TTL ${answer.ttl} с`}</small></article>`).join('')}</div>` : '<p class="dns-no-answer">В ответе нет записей Answer. Проверьте статус ответа и выбранный тип запроса.</p>'}</section>`
        : '<div class="dns-feedback"><span>◎</span><div><strong>Запустите диагностический запрос</strong><p>Результат будет получен из DNS-резолвера Mihomo на роутере. Настройки не изменяются.</p></div></div>';

  return `<section class="page-heading mihomo-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> MIHOMO · ДИАГНОСТИКА</div><h1>DNS</h1><p>Проверьте ответ локального Mihomo DNS по имени и типу записи.</p></div><span class="runtime-badge"><span class="runtime-dot"></span> Запрос по требованию</span></section>
    <section class="dns-workspace"><header class="dns-workspace-heading"><div><span class="selector-kicker">DNS LOOKUP</span><h2>Проверка разрешения имени</h2></div><span class="coming-tag">ТОЛЬКО ЧТЕНИЕ</span></header><form id="dns-query-form" class="dns-query-form"><label><span>Домен или IPv4</span><input name="name" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="253" placeholder="example.com" value="${escapeHtml(queryName)}" required></label><label><span>Тип записи</span><select name="type">${['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SRV', 'HTTPS', 'SVCB'].map((type) => `<option ${queryType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label><button class="button button-primary" type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Запрос…' : 'Проверить DNS'}</button></form>${status}</section>
    <div class="mihomo-privacy-note"><span>i</span><p>Запрос выполняется только после нажатия кнопки и проходит через защищённый backend к Mihomo. Ответ не является проверкой DNS для всех клиентов сети и ничего не меняет в их настройках.</p></div>`;
}
