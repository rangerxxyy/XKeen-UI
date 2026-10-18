export function renderResourceMetrics(
  memory: { usedMb: number; totalMb: number } | null,
  cpuPercent: number | null,
): string {
  const memoryValue = memory ? `${memory.usedMb}/${memory.totalMb} MB` : '—';
  const cpuValue = cpuPercent === null ? '—' : `${Math.round(cpuPercent)}%`;
  return `<span class="resource-metric"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 1.5v1.5m4-1.5v1.5M6 13v1.5m4-1.5v1.5M1.5 6H3m-1.5 4H3m10-4h1.5M13 10h1.5"/></svg><span>RAM ${memoryValue}</span></span><span class="resource-metric-separator" aria-hidden="true">·</span><span class="resource-metric"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 2.5 8 8 14l5.5-6L8 2Z"/><path d="M8 5v4m0 2h.01"/></svg><span>CPU ${cpuValue}</span></span>`;
}
