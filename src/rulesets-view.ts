import { getMihomoRuleProviderContent, getMihomoRuleProviders, type MihomoRuleProvider } from './api';
import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';

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
    for (const value of [String(index + 1), provider.name, provider.format, provider.behavior, new Intl.NumberFormat('ru-RU').format(provider.ruleCount), provider.updatedAt ?? '—']) row.append(node('td', undefined, value));
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
  dialog.innerHTML = `<section class="modal-panel rulesets-panel"><header class="modal-heading"><span class="modal-icon ruleset-title-icon" aria-hidden="true">▱</span><h2>Провайдеры правил</h2><button class="icon-button rulesets-close" type="button" aria-label="Закрыть">×</button></header><label class="rulesets-filter"><span class="visually-hidden">Фильтр rule-set</span><input type="search" placeholder="Фильтр" autocomplete="off"></label><p class="rulesets-status" role="status" aria-live="polite">Загрузка rule-set…</p><div class="rulesets-list"></div><section class="ruleset-content" hidden><header><div><strong></strong><small></small></div><button class="ruleset-content-close" type="button" aria-label="Закрыть содержимое">×</button></header><pre><code></code></pre></section></section>`;
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
