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

export function renderDns(result: MihomoDnsResult | null, loading: boolean, error: string | null, queryName: string, queryType: string, panel: 'mihomo' | 'handoff' = 'mihomo'): string {
  const answers = result?.answers ?? [];
  const status = error
    ? `<div class="dns-feedback is-error" role="alert"><span>!</span><div><strong>Запрос не выполнен</strong><p>${escapeHtml(error)}</p></div></div>`
    : loading
      ? '<div class="dns-feedback"><span class="loading-orbit" aria-hidden="true"></span><div><strong>Проверяем DNS</strong><p>Ждём ответ локального Mihomo API.</p></div></div>'
      : result
        ? `<section class="dns-result"><header><div><span class="selector-kicker">ОТВЕТ MIHOMO</span><h2>${escapeHtml(result.status)}</h2></div><span class="dns-answer-count">${formatAnswerCount(answers.length)}</span></header>${answers.length ? `<div class="dns-record-list">${answers.map((answer) => `<article class="dns-record"><div><strong>${escapeHtml(answer.name)}</strong><span>${escapeHtml(answer.type)}</span></div><code>${escapeHtml(answer.data)}</code><small>${answer.ttl === null ? 'TTL не указан' : `TTL ${answer.ttl} с`}</small></article>`).join('')}</div>` : '<p class="dns-no-answer">В ответе нет записей Answer. Проверьте статус ответа и выбранный тип запроса.</p>'}</section>`
        : '<div class="dns-feedback"><span>◎</span><div><strong>Запустите диагностический запрос</strong><p>Результат будет получен из DNS-резолвера Mihomo на роутере. Настройки не изменяются.</p></div></div>';

  const mihomoPanel = `<section class="dns-workspace dns-mihomo-pane" ${panel === 'handoff' ? 'hidden' : ''}><header class="dns-workspace-heading"><div><span class="selector-kicker">DNS LOOKUP</span><h2>Проверка разрешения имени</h2></div><span class="coming-tag">ТОЛЬКО ЧТЕНИЕ</span></header><form id="dns-query-form" class="dns-query-form"><label><span>Домен или IPv4</span><input name="name" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="253" placeholder="example.com" value="${escapeHtml(queryName)}" required></label><label><span>Тип записи</span><select name="type">${['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SRV', 'HTTPS', 'SVCB'].map((type) => `<option ${type === queryType ? 'selected' : ''}>${type}</option>`).join('')}</select></label><button class="button button-primary" type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Запрос…' : 'Проверить DNS'}</button></form>${status}<div class="mihomo-privacy-note"><span>i</span><p>Запрос выполняется только после нажатия кнопки через backend к Mihomo. Он не меняет DNS клиентов сети.</p></div></section>`;
  const handoffPanel = `<section class="dns-workspace dns-handoff-pane" ${panel === 'mihomo' ? 'hidden' : ''}><header class="dns-workspace-heading"><div><span class="selector-kicker">KEENETICOS ↔ MIHOMO</span><h2>Передача управления DNS</h2></div><span class="state-pill state-stopped"><span class="state-dot"></span> Выключено</span></header><div class="dns-handoff-intro"><p>При включении KeeneticOS будет направлять DNS клиентов на Mihomo. В конфигурации ядра задаётся <code>listen: 0.0.0.0:53</code>, а в Keenetic — IPv4 интерфейса <code>br0</code> (обычно <code>192.168.1.1</code>).</p><div class="alert alert-warning"><span class="alert-icon">!</span><div><strong>Переключение пока недоступно</strong><p>Backend должен сохранять и восстанавливать исходные IPv4/IPv6 DNS, DoH/DoT и состояние контентного фильтра. Одна команда сохранения KeeneticOS не возвращает исходные параметры.</p></div></div></div><div class="dns-handoff-grid"><article class="dns-handoff-step"><span>01</span><div><strong>Снимок настроек</strong><small>IPv4/IPv6, DoH/DoT, DNS-override и контентный фильтр</small></div></article><article class="dns-handoff-step"><span>02</span><div><strong>Передача DNS Mihomo</strong><small>Отключить фильтр Keenetic, установить адрес br0, включить opkg dns-override и сохранить настройки</small></div></article><article class="dns-handoff-step"><span>03</span><div><strong>Откат</strong><small>Возврат снимка и проверка до остановки Mihomo</small></div></article></div><button class="button button-primary dns-handoff-disabled" type="button" disabled aria-describedby="dns-handoff-note"><span class="toggle-switch" aria-hidden="true"></span> Включить управление DNS</button><p id="dns-handoff-note" class="dns-handoff-note">Функция выключена и пока не подключена к API роутера.</p></section>`;

  return `<section class="page-heading mihomo-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> DNS · MIHOMO / РОУТЕР</div><h1>DNS</h1><p>Проверка Mihomo и отдельное управление передачей DNS KeeneticOS.</p></div><span class="runtime-badge"><span class="runtime-dot"></span> ${panel === 'mihomo' ? 'Запрос по требованию' : 'Передача выключена'}</span></section><nav class="dns-subnav" aria-label="Режим DNS"><button type="button" class="dns-subnav-button ${panel === 'mihomo' ? 'is-active' : ''}" data-dns-panel="mihomo" aria-pressed="${panel === 'mihomo'}">DNS Mihomo</button><button type="button" class="dns-subnav-button ${panel === 'handoff' ? 'is-active' : ''}" data-dns-panel="handoff" aria-pressed="${panel === 'handoff'}">Передача DNS роутера</button></nav>${mihomoPanel}${handoffPanel}`;
}
