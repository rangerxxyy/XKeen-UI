import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDialogWithMotion } from './dialog-motion';

describe('closeDialogWithMotion', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the dialog open for the exit transition before closing it', () => {
    vi.useFakeTimers();
    const dialog = {
      open: true,
      dataset: {},
      classList: { add: vi.fn(), remove: vi.fn() },
      close: vi.fn(),
    } as unknown as HTMLDialogElement;

    closeDialogWithMotion(dialog, 'confirm', { durationMs: 160 });

    expect(dialog.classList.add).toHaveBeenCalledWith('is-closing');
    expect(dialog.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(160);
    expect(dialog.classList.remove).toHaveBeenCalledWith('is-closing');
    expect(dialog.close).toHaveBeenCalledWith('confirm');
  });

  it('closes immediately when reduced motion is requested', () => {
    const dialog = {
      open: true,
      dataset: {},
      classList: { add: vi.fn(), remove: vi.fn() },
      close: vi.fn(),
    } as unknown as HTMLDialogElement;

    closeDialogWithMotion(dialog, 'cancel', { reducedMotion: true });

    expect(dialog.classList.add).not.toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalledWith('cancel');
  });
});
