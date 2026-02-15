/**
 * Docker 资源图表 — 控件栏（排序 + TopN）
 */

import type { ChartSortBy, ChartTopN } from "./resource-chart-types";
import { CHART_SORT_OPTIONS, CHART_TOP_N_OPTIONS } from "./resource-chart-types";
import { escapeHtml } from "../../utils/formatters";

/**
 * 渲染排序维度 Segmented Control + TopN 下拉
 */
export function renderChartControls(
  currentSort: ChartSortBy,
  currentTopN: ChartTopN
): string {
  const sortButtons = CHART_SORT_OPTIONS.map((opt) => {
    const active = opt.key === currentSort;
    return `<button
      type="button"
      class="rc-sort-btn ${active ? "active" : ""}"
      data-rc-sort="${opt.key}"
      aria-pressed="${active}"
      title="按${escapeHtml(opt.hint)}排序"
    >${escapeHtml(opt.label)}<span class="rc-sort-hint">${escapeHtml(opt.hint)}</span></button>`;
  }).join("");

  const topNOptions = CHART_TOP_N_OPTIONS.map((n) =>
    `<option value="${n}" ${n === currentTopN ? "selected" : ""}>Top ${n}</option>`
  ).join("");

  return `
    <div class="rc-controls">
      <div class="rc-sort-group" role="group" aria-label="排序维度">
        ${sortButtons}
      </div>
      <select class="rc-topn-select" data-rc-topn aria-label="显示数量" title="选择显示容器数量">
        ${topNOptions}
      </select>
    </div>`;
}
