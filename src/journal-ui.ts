export function journalExpandLabel(expanded: boolean): string {
  return expanded ? 'Свернуть журнал' : 'Развернуть журнал на весь экран';
}

export function journalExpandIcon(expanded: boolean): string {
  const path = expanded
    ? '<path d="M8 3v5H3M3 3l6 6M16 3v5h5m0-5-6 6M3 16h5v5m-5 0 6-6m12 1h-5v5m5 0-6-6"/>'
    : '<path d="M3 8V3h5M3 3l6 6m7-6h5v5m0-5-6 6M8 21H3v-5m0 5 6-6m7 6h5v-5m0 5-6-6"/>';
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
