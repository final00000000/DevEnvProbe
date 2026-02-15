/**
 * Docker 资源图表 — 图例栏
 */

/**
 * 渲染图例 + 溢出提示
 */
export function renderChartLegend(totalCount: number, visibleCount: number): string {
  const hiddenCount = totalCount - visibleCount;
  const overflowHtml = hiddenCount > 0
    ? `<span class="rc-legend-overflow">还有 ${hiddenCount} 个容器未显示</span>`
    : "";

  return `
    <div class="rc-legend" role="note" aria-label="颜色说明">
      <span class="rc-legend-item"><span class="rc-legend-dot rc-dot--ok" aria-hidden="true"></span>正常 &lt;60%</span>
      <span class="rc-legend-item"><span class="rc-legend-dot rc-dot--warn" aria-hidden="true"></span>警告 60-85%</span>
      <span class="rc-legend-item"><span class="rc-legend-dot rc-dot--danger" aria-hidden="true"></span>告警 &gt;85%</span>
      ${overflowHtml}
    </div>`;
}
