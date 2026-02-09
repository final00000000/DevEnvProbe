/**
 * 指标卡片 UI 组件
 */

import { escapeHtml } from "../utils/formatters";

/**
 * 生成指标卡片 HTML
 */
export function getMetricCard(
  title: string,
  value: string,
  subtitle: string,
  trendClass: string,
  showCpuWarning: boolean = false
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

  return `
    <div class="card metric-card animate-fade-in">
      <div class="text-sm text-text-secondary mb-2 flex items-center gap-1">
        ${escapeHtml(title)}
        ${tooltipIcon}
      </div>
      <div class="metric-value text-text-primary">${escapeHtml(value)}</div>
      <div class="text-xs ${trendClass || "text-text-muted"} mt-2">${escapeHtml(subtitle)}</div>
    </div>
  `;
}
