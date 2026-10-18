type DialogCloseOptions = { durationMs?: number; reducedMotion?: boolean };
const DIALOG_EXIT_DURATION_MS = 160;

export function closeDialogWithMotion(dialog: HTMLDialogElement, returnValue = '', options: DialogCloseOptions = {}): void {
  if (!dialog.open || dialog.dataset.closing === 'true') return;
  const reducedMotion = options.reducedMotion
    ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reducedMotion) {
    dialog.close(returnValue);
    return;
  }
  dialog.dataset.closing = 'true';
  dialog.classList.add('is-closing');
  setTimeout(() => {
    if (!dialog.open) return;
    dialog.classList.remove('is-closing');
    delete dialog.dataset.closing;
    dialog.close(returnValue);
  }, options.durationMs ?? DIALOG_EXIT_DURATION_MS);
}

export function bindDialogMotion(dialog: HTMLDialogElement): void {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialogWithMotion(dialog);
  });
  dialog.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement | null;
    if (!form || form.method !== 'dialog') return;
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    closeDialogWithMotion(dialog, submitter?.value ?? '');
  });
}
