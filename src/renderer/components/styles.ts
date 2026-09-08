/** Inline stylesheet, injected once per page. Uses Freelens theme variables. */
export const gpuStyles = `
.gpuext-page { padding: calc(var(--padding) * 2); color: var(--textColorPrimary); }
.gpuext-header { display: flex; align-items: center; gap: var(--padding); margin-bottom: var(--padding); }
.gpuext-header h2 { margin: 0; font-weight: 500; flex: 1; }
.gpuext-status { color: var(--textColorSecondary); font-size: 12px; }
.gpuext-error { color: var(--colorError); margin: var(--padding) 0; white-space: pre-wrap; }
.gpuext-hint { color: var(--textColorSecondary); font-size: 12px; margin: var(--padding) 0; }
.gpuext-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gpuext-table th { text-align: left; font-weight: 500; color: var(--textColorSecondary);
  padding: 6px 10px; border-bottom: 1px solid var(--borderColor); white-space: nowrap; }
.gpuext-table td { padding: 6px 10px; border-bottom: 1px solid var(--borderFaintColor); white-space: nowrap; vertical-align: middle; }
.gpuext-table tr.gpuext-sep td { border-top: 2px solid var(--borderColor); }
.gpuext-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.gpuext-table th.num { text-align: right; }
.gpuext-mono { font-family: var(--font-monospace, monospace); }
.gpuext-dim { color: var(--textColorSecondary); }
.gpuext-bar { display: inline-block; width: 90px; height: 8px; border-radius: 4px; background: var(--borderFaintColor); vertical-align: middle; margin-right: 8px; overflow: hidden; }
.gpuext-bar > span { display: block; height: 100%; border-radius: 4px; }
.gpuext-bar.ok > span { background: var(--colorOk); }
.gpuext-bar.warn > span { background: var(--colorWarning); }
.gpuext-bar.hot > span { background: var(--colorError); }
.gpuext-bar.idle > span { background: var(--textColorTertiary); }
.gpuext-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--borderFaintColor); margin-right: 4px; font-size: 12px; }
.gpuext-details { font-size: 13px; }
.gpuext-details table { width: 100%; }
.gpuext-empty { color: var(--textColorSecondary); padding: calc(var(--padding) * 2); }
.gpuext-actions { display: flex; gap: var(--padding); align-items: center; }
`;

export function utilClass(pct: number): string {
  if (pct >= 90) return "hot";
  if (pct >= 70) return "warn";
  if (pct >= 30) return "ok";
  return "idle";
}

export function fmtMiB(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} GiB`;
  return `${Math.round(v)} MiB`;
}
