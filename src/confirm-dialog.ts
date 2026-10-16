import { bindDialogMotion, closeDialogWithMotion } from './dialog-motion';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character] ?? character;
  });
}

export function confirmInApp(title: string, message: string, confirmLabel: string): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal confirmation-dialog';
  dialog.innerHTML = `<section class="modal-panel"><div class="modal-heading"><span class="modal-icon">!</span><h2>${escapeHtml(title)}</h2></div><p class="modal-note">${escapeHtml(message)}</p><div class="confirmation-actions"><button class="editor-button" type="button" data-confirm-cancel>Отмена</button><button class="editor-button editor-button-primary" type="button" data-confirm-accept>${escapeHtml(confirmLabel)}</button></div></section>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });
    bindDialogMotion(dialog);
    dialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.addEventListener('click', () => closeDialogWithMotion(dialog, 'cancel'));
    dialog.querySelector<HTMLButtonElement>('[data-confirm-accept]')?.addEventListener('click', () => closeDialogWithMotion(dialog, 'confirm'));
    dialog.showModal();
  });
}
