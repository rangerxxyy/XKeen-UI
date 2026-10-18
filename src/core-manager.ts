import { bindDialogMotion } from './dialog-motion';

export interface CoreManagerVersions {
  mihomo: CoreManagerState;
  xray: CoreManagerState;
}

export interface CoreManagerState {
  installed: boolean;
  active: boolean;
  version: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function renderCoreManager(versions: CoreManagerVersions): string {
  const row = (core: 'xray' | 'mihomo', name: string, state: CoreManagerState) => {
    const installed = state.installed;
    const status = state.active ? 'Активно' : installed ? 'Установлено' : 'Не установлено';
    const statusClass = state.active ? 'is-active' : installed ? 'is-installed' : 'is-missing';
    return `<div class="core-manager-row"><div class="core-manager-info"><div class="core-manager-title"><strong>${name}</strong><span class="core-manager-status ${statusClass}">${status}</span></div>${state.version ? `<small>${escapeHtml(state.version)}</small>` : ''}</div><button class="button button-primary" type="button" data-core-action="${core}">${installed ? 'Обновить' : 'Установить'}</button></div>`;
  };

  return `<div class="modal-panel core-manager-panel"><div class="modal-heading"><span class="modal-icon">⚙</span><h2>Управление ядром</h2><button class="icon-button" data-core-manager-close type="button" aria-label="Закрыть">×</button></div><div class="core-manager-rows">${row('xray', 'Xray', versions.xray)}${row('mihomo', 'Mihomo', versions.mihomo)}</div></div>`;
}

export function openCoreManagerDialog(versions: CoreManagerVersions, onSelect: (core: 'xray' | 'mihomo') => void): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal core-manager-dialog';
  dialog.innerHTML = renderCoreManager(versions);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  bindDialogMotion(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-core-manager-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-core-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const core = button.dataset.coreAction;
      if (core !== 'xray' && core !== 'mihomo') return;
      dialog.close();
      onSelect(core);
    });
  });
}
