/**
 * 指标卡片 UI 组件
 */

import { escapeHtml, getProgressColorClass } from "../utils/formatters";

/**
 * 生成指标卡片 HTML
 *
 * @param progress - 可选，0-100 的百分比值。传入后在数值下方渲染语义色进度条。
 */
export function getMetricCard(
  title: string,
  value: string,
  subtitle: string,
  trendClass: string,
  showCpuWarning: boolean = false,
  progress?: number | null
): string {
  const tooltipIcon = showCpuWarning ? `
    <button
      type="button"
      class="metric-tooltip-icon"
      data-cpu-tip-trigger="true"
      aria-label="查看 CPU 采样说明"
      title="查看 CPU 采样说明"
    >ⓘ</button>
  ` : '';

  let progressBarHtml = "";
  if (progress !== undefined && progress !== null && Number.isFinite(progress)) {
    const clamped = Math.max(0, Math.min(100, progress));
    const colorClass = getProgressColorClass(clamped);
    progressBarHtml = `
      <div class="metric-progress-track" role="progressbar" aria-valuenow="${clamped.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(title)}">
        <div class="metric-progress-fill ${colorClass}" style="width:${clamped.toFixed(1)}%"></div>
      </div>`;
  }

  return `
    <div class="card metric-card animate-fade-in">
      <div class="text-sm text-text-secondary mb-2 flex items-center gap-1">
        ${escapeHtml(title)}
        ${tooltipIcon}
      </div>
      <div class="metric-value text-text-primary">${escapeHtml(value)}</div>
      ${progressBarHtml}
      <div class="text-xs ${trendClass || "text-text-muted"} mt-2">${escapeHtml(subtitle)}</div>
    </div>
  `;
}
