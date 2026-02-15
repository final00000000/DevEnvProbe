/**
 * Docker 资源图表 — 主组件
 *
 * 编排所有子组件，提供增量 DOM 更新能力。
 */

import type { DockerStatItem } from "../../types";
import type { ChartSortBy, ChartTopN } from "./resource-chart-types";
import { CHART_COLOR_THRESHOLDS } from "./resource-chart-types";
import { renderChartControls } from "./resource-chart-controls";
import { renderChartEmpty } from "./resource-chart-empty";
import { renderChartLegend } from "./resource-chart-legend";
import { renderChartRow, sortStats } from "./resource-chart-row";

/** 计算 NET 模式下各行的相对宽度 */
function computeNetBarWidths(items: readonly DockerStatItem[]): Map<string, number> {
  const widths = new Map<string, number>();
  if (items.length === 0) return widths;

  let maxBytes = 0;
  for (const item of items) {
    const total = item.netRxBytes + item.netTxBytes;
    if (total > maxBytes) maxBytes = total;
  }

  for (const item of items) {
    const total = item.netRxBytes + item.netTxBytes;
    widths.set(item.name, maxBytes > 0 ? (total / maxBytes) * 100 : 0);
  }

  return widths;
}

/** 解析行 HTML 并替换 NET 占位宽度 */
function resolveRowHtml(
  item: DockerStatItem,
  sortBy: ChartSortBy,
  index: number,
  netWidths: Map<string, number> | null
): string {
  const row = renderChartRow(item, sortBy, index);
  if (netWidths) {
    const pct = netWidths.get(item.name) ?? 0;
    return row.replace("var(--rc-net-bar-width, 0%)", `${pct.toFixed(1)}%`);
  }
  return row;
}

/**
 * 生成完整的资源图表 HTML（首次渲染 / 全量重绘）
 */
export function getDockerResourceChart(
  stats: readonly DockerStatItem[],
  sortBy: ChartSortBy = "cpu",
  topN: ChartTopN = 5
): string {
  if (stats.length === 0) {
    return `
      <div class="card animate-fade-in rc-card" role="region" aria-label="容器资源排行">
        ${renderChartEmpty()}
      </div>`;
  }

  const sorted = sortStats(stats, sortBy);
  const visible = sorted.slice(0, topN);
  const netWidths = sortBy === "net" ? computeNetBarWidths(visible) : null;

  const rows = visible
    .map((item, i) => resolveRowHtml(item, sortBy, i, netWidths))
    .join("");

  return `
    <div class="card animate-fade-in rc-card" role="region" aria-label="容器资源排行">
      <div class="rc-head">
        <span class="rc-title">容器资源排行</span>
        ${renderChartControls(sortBy, topN)}
      </div>
      <div class="rc-body" role="list" aria-live="polite">
        ${rows}
      </div>
      ${renderChartLegend(stats.length, visible.length)}
    </div>`;
}

/**
 * 增量更新资源图表 DOM（保留 CSS transition 动画）
 *
 * @returns true = 增量更新成功，false = 需要全量重绘
 */
export function updateDockerResourceChart(
  host: HTMLElement,
  stats: readonly DockerStatItem[],
  sortBy: ChartSortBy = "cpu",
  topN: ChartTopN = 5
): boolean {
  const card = host.querySelector(".rc-card");
  if (!card) return false;

  if (stats.length === 0) {
    host.innerHTML = getDockerResourceChart(stats, sortBy, topN);
    return true;
  }

  const body = card.querySelector(".rc-body");
  if (!body) return false;

  const sorted = sortStats(stats, sortBy);
  const visible = sorted.slice(0, topN);
  const netWidths = sortBy === "net" ? computeNetBarWidths(visible) : null;

  // 更新控件激活态
  card.querySelectorAll<HTMLButtonElement>(".rc-sort-btn").forEach((btn) => {
    const active = btn.dataset.rcSort === sortBy;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const selectEl = card.querySelector<HTMLSelectElement>(".rc-topn-select");
  if (selectEl && selectEl.value !== String(topN)) {
    selectEl.value = String(topN);
  }

  // 比对并更新行
  const visibleNames = new Set(visible.map((item) => item.name));
  const existingRows = body.querySelectorAll<HTMLElement>(".rc-row");
  const existingMap = new Map<string, HTMLElement>();

  existingRows.forEach((row) => {
    const name = row.dataset.rcContainer ?? "";
    if (!visibleNames.has(name)) {
      row.classList.add("rc-row--exit");
      window.setTimeout(() => row.remove(), 300);
    } else {
      existingMap.set(name, row);
    }
  });

  visible.forEach((item, i) => {
    const existing = existingMap.get(item.name);
    if (existing) {
      // 增量更新进度条
      const fill = existing.querySelector<HTMLElement>(".rc-row-bar-fill");
      if (fill) {
        let pct: number;
        if (sortBy === "net" && netWidths) {
          pct = netWidths.get(item.name) ?? 0;
        } else if (sortBy === "mem") {
          pct = Math.max(0, Math.min(100, item.memUsagePercent ?? 0));
        } else {
          pct = Math.max(0, Math.min(100, item.cpuPercent));
        }

        fill.style.width = `${pct.toFixed(1)}%`;
        fill.classList.remove("rc-fill--ok", "rc-fill--warn", "rc-fill--danger");
        if (sortBy === "net") {
          fill.classList.add("rc-fill--ok");
        } else if (pct >= CHART_COLOR_THRESHOLDS.warn) {
          fill.classList.add("rc-fill--danger");
        } else if (pct >= CHART_COLOR_THRESHOLDS.ok) {
          fill.classList.add("rc-fill--warn");
        } else {
          fill.classList.add("rc-fill--ok");
        }
        fill.setAttribute("aria-valuenow", pct.toFixed(0));
      }

      // 更新数值
      const valueEl = existing.querySelector(".rc-row-value");
      if (valueEl) {
        let label: string;
        if (sortBy === "mem") {
          const used = item.memUsageText.split("/")[0]?.trim() ?? "--";
          label = `${used} (${(item.memUsagePercent ?? 0).toFixed(1)}%)`;
        } else if (sortBy === "net") {
          label = item.netIoText;
        } else {
          label = item.cpuText;
        }
        if (valueEl.textContent !== label) valueEl.textContent = label;
      }

      // 更新圆点
      const dot = existing.querySelector(".rc-row-dot");
      if (dot) {
        dot.classList.remove("rc-dot--ok", "rc-dot--warn", "rc-dot--danger");
        const dotPct = sortBy === "net" ? 0 : sortBy === "mem" ? (item.memUsagePercent ?? 0) : item.cpuPercent;
        if (dotPct >= CHART_COLOR_THRESHOLDS.warn) dot.classList.add("rc-dot--danger");
        else if (dotPct >= CHART_COLOR_THRESHOLDS.ok) dot.classList.add("rc-dot--warn");
        else dot.classList.add("rc-dot--ok");
      }

      // 更新 tooltip
      const memPct = item.memUsagePercent !== null ? `${item.memUsagePercent.toFixed(1)}%` : "--";
      existing.title = `CPU: ${item.cpuText} | 内存: ${item.memUsageText} (${memPct}) | 网络: ${item.netIoText}`;
    } else {
      // 新增行
      const rowHtml = resolveRowHtml(item, sortBy, i, netWidths);
      const temp = document.createElement("div");
      temp.innerHTML = rowHtml;
      const newRow = temp.firstElementChild;
      if (newRow) {
        newRow.classList.add("rc-row--enter");
        body.appendChild(newRow);
      }
    }
  });

  // 更新图例
  const legendHost = card.querySelector(".rc-legend");
  if (legendHost) {
    const newLegend = renderChartLegend(stats.length, visible.length);
    const temp = document.createElement("div");
    temp.innerHTML = newLegend;
    const newLegendEl = temp.firstElementChild;
    if (newLegendEl) {
      legendHost.replaceWith(newLegendEl);
    }
  }

  return true;
}
