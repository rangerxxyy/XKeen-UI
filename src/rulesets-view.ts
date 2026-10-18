import { getMihomoRuleProviderContent, getMihomoRuleProviders, type MihomoRuleProvider } from './api';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';

const relativeTime = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

export function formatRuleUpdatedAt(value: string | null, now = Date.now()): string {
  if (!value || value.startsWith('0001-01-01')) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const elapsed = Math.max(0, (now - date.getTime()) / 1000);
  if (elapsed < 45) return 'только что';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, seconds] = units.find(([, length]) => elapsed >= length) ?? units[units.length - 1]!;
  return relativeTime.format(-Math.round(elapsed / seconds), unit);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function renderProviders(target: HTMLElement, providers: MihomoRuleProvider[], filter: string, onView: (provider: MihomoRuleProvider) => void): void {
  const query = filter.trim().toLocaleLowerCase('ru');
  const visible = providers.filter((provider) => `${provider.name} ${provider.format} ${provider.behavior}`.toLocaleLowerCase('ru').includes(query));
  target.replaceChildren();
  const table = node('table', 'ruleset-table');
  const head = node('thead');
  const header = node('tr');
  for (const label of ['#', 'Название', 'Формат', 'Поведение', 'Правил', 'Обновлено', '']) header.append(node('th', undefined, label));
  head.append(header);
  table.append(head);
  const body = node('tbody');
  visible.forEach((provider, index) => {
    const row = node('tr');
    row.append(node('td', 'ruleset-index', String(index + 1)));
    row.append(node('td', 'ruleset-name', provider.name));
    row.append(node('td', 'ruleset-format', provider.format));
    row.append(node('td', 'ruleset-behavior', provider.behavior));
    row.append(node('td', 'ruleset-count', new Intl.NumberFormat('ru-RU').format(provider.ruleCount)));
    row.append(node('td', 'ruleset-updated', formatRuleUpdatedAt(provider.updatedAt)));
    const action = node('td');
    const button = node('button', 'ruleset-view-button', 'Посмотреть');
    button.type = 'button';
    button.setAttribute('aria-label', `Посмотреть содержимое rule-set ${provider.name}`);
    button.addEventListener('click', () => onView(provider));
    action.append(button);
    row.append(action);
    body.append(row);
  });
  table.append(body);
  target.append(table);
  if (!visible.length) target.append(node('p', 'ruleset-empty', 'Подходящих rule-set не найдено.'));
}

export async function openRulesetsDialog(): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal rulesets-dialog';
  dialog.innerHTML = `<section class="modal-panel rulesets-panel"><header class="modal-heading"><span class="modal-icon ruleset-title-icon" aria-hidden="true">▱</span><div class="rulesets-heading-copy"><h2>Провайдеры правил</h2><p>Rule-set из активной конфигурации Mihomo</p></div><button class="icon-button rulesets-close" type="button" aria-label="Закрыть">×</button></header><label class="rulesets-filter"><span class="visually-hidden">Фильтр rule-set</span><input type="search" placeholder="Поиск по названию и типу" autocomplete="off"></label><p class="rulesets-status" role="status" aria-live="polite">Загрузка rule-set…</p><div class="rulesets-list"></div><section class="ruleset-content" hidden><header><div><strong></strong><small></small></div><button class="ruleset-content-close" type="button" aria-label="Закрыть содержимое">×</button></header><pre><code></code></pre></section></section>`;
  document.body.append(dialog);
  bindDialogMotion(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector<HTMLButtonElement>('.rulesets-close')?.addEventListener('click', () => closeDialogWithMotion(dialog));
  const filter = dialog.querySelector<HTMLInputElement>('.rulesets-filter input')!;
  const target = dialog.querySelector<HTMLElement>('.rulesets-list')!;
  const status = dialog.querySelector<HTMLElement>('.rulesets-status')!;
  const content = dialog.querySelector<HTMLElement>('.ruleset-content')!;
  const contentTitle = content.querySelector<HTMLElement>('strong')!;
  const contentPath = content.querySelector<HTMLElement>('small')!;
  const contentCode = content.querySelector<HTMLElement>('code')!;
  let providers: MihomoRuleProvider[] = [];
  const onView = async (provider: MihomoRuleProvider) => {
    content.hidden = false;
    contentTitle.textContent = provider.name;
    contentPath.textContent = 'Загружаем содержимое…';
    contentCode.textContent = '';
    try {
      const result = await getMihomoRuleProviderContent(provider.name);
      if (!dialog.isConnected) return;
      contentPath.textContent = result.path;
      contentCode.textContent = result.content;
    } catch (error) {
      contentPath.textContent = error instanceof Error ? error.message : 'Не удалось прочитать rule-set.';
    }
  };
  dialog.querySelector<HTMLButtonElement>('.ruleset-content-close')?.addEventListener('click', () => { content.hidden = true; });
  filter.addEventListener('input', () => renderProviders(target, providers, filter.value, onView));
  try {
    providers = await getMihomoRuleProviders();
    status.textContent = `${providers.length} rule-set из активной конфигурации Mihomo`;
    renderProviders(target, providers, filter.value, onView);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Не удалось получить список rule-set.';
  }
}
