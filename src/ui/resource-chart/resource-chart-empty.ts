/**
 * Docker 资源图表 — 空状态 / 加载态
 */

/** 无数据时的友好提示 */
export function renderChartEmpty(): string {
  return `
    <div class="rc-empty" role="status">
      <div class="rc-empty-icon" aria-hidden="true">📊</div>
      <div class="rc-empty-title">暂无容器资源数据</div>
      <div class="rc-empty-hint">请先启动 Docker 容器，然后点击上方「刷新概览」按钮获取资源监控数据。</div>
    </div>`;
}

/** 加载中骨架屏 */
export function renderChartSkeleton(): string {
  const rows = Array.from({ length: 3 }, (_, i) => `
    <div class="rc-skeleton-row" style="animation-delay:${i * 0.1}s">
      <div class="rc-skeleton-name"></div>
      <div class="rc-skeleton-bar"></div>
      <div class="rc-skeleton-value"></div>
    </div>`).join("");

  return `
    <div class="rc-skeleton" role="status" aria-label="正在加载资源数据">
      ${rows}
    </div>`;
}
