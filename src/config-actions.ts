export function canPersistConfig(content: string, snapshot: string | null, valid: boolean, busy = false): boolean {
  return snapshot !== null && content !== snapshot && valid && !busy;
}

export const CONFIG_APPLY_EVENT = 'xkeen:config-apply';

export type ConfigApplyEventDetail =
  | { phase: 'start'; core: 'mihomo' | 'xray' }
  | { phase: 'finish'; core: 'mihomo' | 'xray'; success: boolean };

/** Notify the header for the full backend validation/restart request, including failures. */
export async function runConfigApply<T>(
  core: 'mihomo' | 'xray',
  operation: () => Promise<T>,
  target: EventTarget = window,
): Promise<T> {
  const emit = (detail: ConfigApplyEventDetail) => target.dispatchEvent(new CustomEvent(CONFIG_APPLY_EVENT, { detail }));
  let success = false;
  emit({ phase: 'start', core });
  try {
    const result = await operation();
    success = true;
    return result;
  } finally {
    emit({ phase: 'finish', core, success });
  }
}
