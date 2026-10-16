export function canPersistConfig(content: string, snapshot: string | null, valid: boolean, busy = false): boolean {
  return snapshot !== null && content !== snapshot && valid && !busy;
}
