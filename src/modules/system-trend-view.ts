import { clampPercent, escapeHtml, formatPercent, getBadgeClassByUsage } from "../utils/formatters";
import type { SystemTrendState } from "./system-trend-state";

function buildTrendPolylinePoints(values: number[]): string {
  if (values.length === 0) {
    return "0,35 100,35";
  }

  if (values.length === 1) {
    const y = 35 - (clampPercent(values[0]) / 100) * 34;
    const normalized = y.toFixed(2);
    return `0,${normalized} 100,${normalized}`;
  }

  const maxIndex = values.length - 1;
  return values
    .map((value, index) => {
      const x = (index / maxIndex) * 100;
      const y = 35 - (clampPercent(value) / 100) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function getSystemTrendMetaText(state: SystemTrendState): string {
  const seconds = Math.max(state.cpuHistory.length, state.memoryHistory.length, 1);
  const updatedAt = state.lastUpdatedAt > 0 ? new Date(state.lastUpdatedAt) : new Date();
  const timeText = updatedAt.toLocaleTimeString("zh-CN", { hour12: false });
  return `最近 ${seconds} 秒 · 更新 ${timeText}`;
}

export function getSystemTrendCardsHtml(state: SystemTrendState): string {
  const latestCpu = state.cpuHistory.length > 0 ? state.cpuHistory[state.cpuHistory.length - 1] : 0;
  const latestMemory = state.memoryHistory.length > 0 ? state.memoryHistory[state.memoryHistory.length - 1] : 0;
  const metaText = escapeHtml(getSystemTrendMetaText(state));

  return `
    <div class="card neo-trend-card animate-fade-in">
      <div class="neo-trend-head">
        <div>
          <h3 class="neo-trend-title">CPU 趋势</h3>
          <p class="neo-trend-subtitle">实时监控曲线</p>
        </div>
        <span id="system-cpu-trend-badge" class="badge ${getBadgeClassByUsage(latestCpu)}">${formatPercent(latestCpu, true)}</span>
      </div>
      <svg class="neo-trend-svg" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
        <polyline id="system-cpu-trend-line" class="neo-trend-line neo-trend-line-cpu" points="${buildTrendPolylinePoints(state.cpuHistory)}"></polyline>
      </svg>
      <div id="system-cpu-trend-meta" class="neo-trend-meta">${metaText}</div>
    </div>

    <div class="card neo-trend-card animate-fade-in">
      <div class="neo-trend-head">
        <div>
          <h3 class="neo-trend-title">内存趋势</h3>
          <p class="neo-trend-subtitle">秒级实时更新</p>
        </div>
        <span id="system-memory-trend-badge" class="badge ${getBadgeClassByUsage(latestMemory)}">${formatPercent(latestMemory, true)}</span>
      </div>
      <svg class="neo-trend-svg" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
        <polyline id="system-memory-trend-line" class="neo-trend-line neo-trend-line-memory" points="${buildTrendPolylinePoints(state.memoryHistory)}"></polyline>
      </svg>
      <div id="system-memory-trend-meta" class="neo-trend-meta">${metaText}</div>
    </div>
  `;
}

export function updateSystemTrendWidgets(
  container: HTMLElement,
  state: SystemTrendState,
  cpuUsagePercent: number,
  memoryUsagePercent: number
): void {
  const cpuLine = container.querySelector<SVGPolylineElement>("#system-cpu-trend-line");
  if (cpuLine) {
    cpuLine.setAttribute("points", buildTrendPolylinePoints(state.cpuHistory));
  }

  const memoryLine = container.querySelector<SVGPolylineElement>("#system-memory-trend-line");
  if (memoryLine) {
    memoryLine.setAttribute("points", buildTrendPolylinePoints(state.memoryHistory));
  }

  const cpuBadge = container.querySelector<HTMLElement>("#system-cpu-trend-badge");
  if (cpuBadge) {
    cpuBadge.className = `badge ${getBadgeClassByUsage(cpuUsagePercent)}`;
    cpuBadge.textContent = formatPercent(cpuUsagePercent, true);
  }

  const memoryBadge = container.querySelector<HTMLElement>("#system-memory-trend-badge");
  if (memoryBadge) {
    memoryBadge.className = `badge ${getBadgeClassByUsage(memoryUsagePercent)}`;
    memoryBadge.textContent = formatPercent(memoryUsagePercent, true);
  }

  const metaText = getSystemTrendMetaText(state);
  const cpuMeta = container.querySelector<HTMLElement>("#system-cpu-trend-meta");
  if (cpuMeta) {
    cpuMeta.textContent = metaText;
  }

  const memoryMeta = container.querySelector<HTMLElement>("#system-memory-trend-meta");
  if (memoryMeta) {
    memoryMeta.textContent = metaText;
  }
}

