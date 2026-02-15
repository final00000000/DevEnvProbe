/**
 * Docker 资源图表 — 单行渲染
 */

import type { DockerStatItem } from "../../types";
import type { ChartSortBy } from "./resource-chart-types";
import { CHART_COLOR_THRESHOLDS } from "./resource-chart-types";
import { escapeHtml } from "../../utils/formatters";

/** 获取进度条颜色 class */
function getColorLevel(percent: number): string {
  if (percent >= CHART_COLOR_THRESHOLDS.warn) return "rc-fill--danger";
  if (percent >= CHART_COLOR_THRESHOLDS.ok) return "rc-fill--warn";
  return "rc-fill--ok";
}

/** 获取状态圆点 class */
function getDotLevel(percent: number): string {
  if (percent >= CHART_COLOR_THRESHOLDS.warn) return "rc-dot--danger";
  if (percent >= CHART_COLOR_THRESHOLDS.ok) return "rc-dot--warn";
  return "rc-dot--ok";
}

/** 获取排序维度对应的数值 */
function getSortValue(item: DockerStatItem, sortBy: ChartSortBy): number {
  if (sortBy === "mem") return item.memUsagePercent ?? 0;
  if (sortBy === "net") return item.netRxBytes + item.netTxBytes;
  return item.cpuPercent;
}

/** 获取进度条百分比 */
function getBarPercent(item: DockerStatItem, sortBy: ChartSortBy): number {
  if (sortBy === "mem") return Math.max(0, Math.min(100, item.memUsagePercent ?? 0));
  if (sortBy === "net") return 0;
  return Math.max(0, Math.min(100, item.cpuPercent));
}

/** 获取数值文本 */
function getBarLabel(item: DockerStatItem, sortBy: ChartSortBy): string {
  if (sortBy === "mem") {
    const used = item.memUsageText.split("/")[0]?.trim() ?? "--";
    return `${used} (${(item.memUsagePercent ?? 0).toFixed(1)}%)`;
  }
  if (sortBy === "net") return item.netIoText;
  return item.cpuText;
}

/** 构建全维度 tooltip */
function buildTooltip(item: DockerStatItem): string {
  const memPct = item.memUsagePercent !== null ? `${item.memUsagePercent.toFixed(1)}%` : "--";
  return `CPU: ${item.cpuText} | 内存: ${item.memUsageText} (${memPct}) | 网络: ${item.netIoText}`;
}

/** 按指定维度排序 */
export function sortStats(
  stats: readonly DockerStatItem[],
  sortBy: ChartSortBy
): DockerStatItem[] {
  return [...stats].sort((a, b) => getSortValue(b, sortBy) - getSortValue(a, sortBy));
}

/** 渲染单行 HTML */
export function renderChartRow(
  item: DockerStatItem,
  sortBy: ChartSortBy,
  index: number
): string {
  const percent = getBarPercent(item, sortBy);
  const colorClass = sortBy === "net" ? "rc-fill--ok" : getColorLevel(percent);
  const dotClass = sortBy === "net" ? "rc-dot--ok" : getDotLevel(percent);
  const label = getBarLabel(item, sortBy);
  const tooltip = buildTooltip(item);
  const barWidth = sortBy === "net" ? "var(--rc-net-bar-width, 0%)" : `${percent.toFixed(1)}%`;

  return `
    <div
      class="rc-row"
      data-rc-container="${escapeHtml(item.name)}"
      role="listitem"
      tabindex="0"
      title="${escapeHtml(tooltip)}"
      style="animation-delay:${index * 0.04}s"
    >
      <span class="rc-row-dot ${dotClass}" aria-hidden="true"></span>
      <span class="rc-row-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <div class="rc-row-bar-track">
        <div
          class="rc-row-bar-fill ${colorClass}"
          style="width:${barWidth}"
          role="progressbar"
          aria-valuenow="${percent.toFixed(0)}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="${escapeHtml(item.name)} ${escapeHtml(label)}"
        ></div>
      </div>
      <span class="rc-row-value">${escapeHtml(label)}</span>
    </div>`;
}
