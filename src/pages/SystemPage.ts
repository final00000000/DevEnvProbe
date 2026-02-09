/**
 * System 页面渲染模块
 */

import { systemState, appState } from "../state";
import { systemService } from "../services";
import { getMetricCard } from "../ui";
import { getSystemTrendCardsHtml, updateSystemTrendWidgets } from "../modules/system-trend-view";
import { getErrorBlock } from "../modules/shell-ui";
import type { SystemSnapshot } from "../types";
import {
  escapeHtml,
  formatPercent,
  formatGb,
  formatUptime,
  getBadgeClassByUsage,
  getProgressColorClass,
  clampPercent,
} from "../utils/formatters";

/**
 * System 页面渲染类
 */
export class SystemPage {
  private cpuHintModalEventsBound = false;

  /**
   * 渲染 System 页面
   */
  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    const snapshotFresh = systemService.isSnapshotFresh();

    // 如果有缓存，立即显示
    if (systemState.snapshotCache && !container.querySelector("#system-dashboard")) {
      this.renderWithSnapshot(container, systemState.snapshotCache, 0);
      this.renderAnchoredUptimeIfVisible();
    }

    if (snapshotFresh) {
      return;
    }

    // 异步获取新数据（不阻塞UI）
    const response = await systemService.fetchSystemSnapshot();
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "system")) {
      const hasDashboard = container.querySelector("#system-dashboard") !== null;
      if (!hasDashboard && appState.currentPage === "system") {
        if (response.ok && response.data) {
          this.renderWithSnapshot(container, response.data, response.elapsedMs);
          this.renderAnchoredUptimeIfVisible();
        } else if (systemState.snapshotCache) {
          this.renderWithSnapshot(container, systemState.snapshotCache, 0);
          this.renderAnchoredUptimeIfVisible();
        } else {
          container.innerHTML = getErrorBlock("系统信息获取失败", response.error ?? "未知错误");
        }
      }
      return;
    }
    if (!response.ok || !response.data) {
      // 如果有缓存，保持显示缓存；否则显示错误
      if (!systemState.snapshotCache) {
        container.innerHTML = getErrorBlock("系统信息获取失败", response.error ?? "未知错误");
      }
      return;
    }

    this.renderWithSnapshot(container, response.data, response.elapsedMs);
    this.renderAnchoredUptimeIfVisible();
  }

  /**
   * 使用快照数据渲染页面
   */
  private renderWithSnapshot(container: HTMLElement, snapshot: SystemSnapshot, elapsedMs: number): void {
    const diskCount = snapshot.disks.length;
    const cpuUsagePercent = clampPercent(snapshot.cpuUsagePercent);
    const memoryUsagePercent = clampPercent(snapshot.memoryUsagePercent);
    const cpuSamplingHint = this.buildCpuSamplingHint(snapshot);
    const hasMemoryCapacity = snapshot.totalMemoryGb > 0;
    const memoryValueText = hasMemoryCapacity ? formatGb(snapshot.usedMemoryGb) : "采集中...";
    const memorySubtitleText = hasMemoryCapacity ? `总计 ${formatGb(snapshot.totalMemoryGb)}` : "正在读取总内存...";
    const shouldShowOverviewLoading = this.shouldShowOverviewLoading(snapshot);
    const diskCardValue = shouldShowOverviewLoading && diskCount === 0 ? "--" : String(diskCount);
    const diskCardSubtitle = diskCount > 0 ? "已挂载" : shouldShowOverviewLoading ? "正在采集中..." : "未检测到";
    const cpuTopologyText = this.buildCpuTopologyText(snapshot);
    const elapsedText = elapsedMs > 0 ? `${elapsedMs}ms` : "--";
    const overviewLoadingBlock = shouldShowOverviewLoading
      ? '<div class="system-overview-loading"><span class="system-overview-loading-dot" aria-hidden="true"></span><span>正在获取完整系统信息，请稍候...</span></div>'
      : "";

    const topCards = [
      getMetricCard("CPU 占用", formatPercent(cpuUsagePercent, true), cpuSamplingHint, "metric-trend-up", true),
      getMetricCard("内存占用", memoryValueText, memorySubtitleText, "", false),
      getMetricCard("磁盘分区", diskCardValue, diskCardSubtitle, "", false),
      getMetricCard("运行时长", formatUptime(snapshot.uptimeSeconds), "系统启动至今", "metric-trend-up", false),
    ].join("");

    const trendCards = getSystemTrendCardsHtml(systemState.trendState);

    const diskBlocks = snapshot.disks.length > 0
      ? snapshot.disks
          .map((disk: any) => {
            return `
        <div class="card animate-fade-in">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-semibold text-text-primary">磁盘 ${escapeHtml(disk.name)}</h4>
            <span class="badge ${getBadgeClassByUsage(disk.usagePercent)}">${formatPercent(disk.usagePercent)}</span>
          </div>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-text-secondary">挂载点</span><span class="text-text-primary">${escapeHtml(
              disk.mountPoint
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">总容量</span><span class="text-text-primary">${formatGb(
              disk.totalGb
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">已使用</span><span class="text-text-primary">${formatGb(
              disk.usedGb
            )}</span></div>
            <div class="w-full bg-bg-tertiary rounded-full h-2 mt-2">
              <div class="h-2 rounded-full ${getProgressColorClass(
                disk.usagePercent
              )}" style="width: ${Math.min(100, Math.max(0, disk.usagePercent))}%"></div>
            </div>
          </div>
        </div>
      `;
          })
          .join("")
      : `<div class="card animate-fade-in col-span-3"><div class="text-sm text-text-secondary">${
          shouldShowOverviewLoading ? "磁盘信息采集中..." : "未检测到磁盘分区信息"
        }</div></div>`;

    container.innerHTML = `
    <div id="system-dashboard" class="space-y-5">
      <div class="grid grid-cols-4 gap-4">${topCards}</div>

      <div class="grid grid-cols-2 gap-4">${trendCards}</div>

      <div class="grid grid-cols-3 gap-4">
        <div class="card col-span-2 animate-fade-in">
          <h3 class="text-lg font-semibold text-text-primary mb-3">系统资源概览</h3>
          ${overviewLoadingBlock}
          <div class="space-y-3 text-sm">
            <div class="flex justify-between"><span class="text-text-secondary">主机名</span><span class="text-text-primary">${escapeHtml(
              snapshot.hostName || "未知"
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">操作系统</span><span class="text-text-primary">${escapeHtml(
              snapshot.osName || "未知"
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">版本</span><span class="text-text-primary">${escapeHtml(
              snapshot.osVersion || "未知"
            )}${snapshot.buildNumber ? ` (build ${escapeHtml(snapshot.buildNumber)})` : ""}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">架构</span><span class="text-text-primary">${escapeHtml(
              snapshot.architecture || "未知"
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">CPU</span><span class="text-text-primary" title="${escapeHtml(snapshot.cpuModel || "未知")}">${escapeHtml(
              snapshot.cpuModel || "未知"
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">CPU 核心</span><span class="text-text-primary">${escapeHtml(
              cpuTopologyText
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">采样模式</span><span id="system-cpu-sample-hint" class="text-text-primary">${escapeHtml(
              cpuSamplingHint
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">数据延迟</span><span id="system-snapshot-elapsed" class="text-text-primary">${elapsedText}</span></div>
          </div>
        </div>

        <div class="card animate-fade-in">
          <h3 class="text-lg font-semibold text-text-primary mb-3">健康状态</h3>
          <div class="space-y-3 text-sm">
            <div class="flex items-center justify-between"><span class="text-text-secondary">CPU</span><span class="badge ${getBadgeClassByUsage(
              cpuUsagePercent
            )}">${formatPercent(cpuUsagePercent, true)}</span></div>
            <div class="flex items-center justify-between"><span class="text-text-secondary">内存</span><span class="badge ${getBadgeClassByUsage(
              memoryUsagePercent
            )}">${formatPercent(memoryUsagePercent, true)}</span></div>
            <div class="text-text-secondary text-xs">系统页仅在当前激活时自动刷新，切到其他页面会自动暂停。</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4">${diskBlocks}</div>
    </div>
  `;

    this.bindCpuSamplingHintTrigger(container);
  }

  /**
   * 刷新系统部分数据（轻量级）
   */
  async refreshPartial(container: HTMLElement, renderEpoch: number): Promise<void> {
    const response = await systemService.fetchSystemRealtime();
    if (appState.isRenderStale(renderEpoch, "system")) {
      return;
    }

    if (!response.ok || !response.data) {
      return;
    }

    const realtime = response.data;
    const cpuUsagePercent = clampPercent(realtime.cpuUsagePercent);
    const memoryUsagePercent = clampPercent(realtime.memoryUsagePercent);
    const cpuSamplingHint = this.buildCpuSamplingHint(realtime);

    if (!container.querySelector("#system-dashboard")) {
      return;
    }

    // 更新指标卡片
    const metricValues = container.querySelectorAll<HTMLElement>(".metric-card .metric-value");
    if (metricValues.length >= 4) {
      metricValues[0].textContent = formatPercent(cpuUsagePercent, true);
      metricValues[1].textContent = realtime.totalMemoryGb > 0 ? formatGb(realtime.usedMemoryGb) : "采集中...";
      metricValues[3].textContent = formatUptime(systemState.getAnchoredUptimeSeconds());
    }

    const metricSubtitles = container.querySelectorAll<HTMLElement>(".metric-card .text-xs");
    if (metricSubtitles.length >= 4) {
      metricSubtitles[0].textContent = cpuSamplingHint;
      metricSubtitles[1].textContent = realtime.totalMemoryGb > 0 ? `总内存 ${formatGb(realtime.totalMemoryGb)}` : "正在读取总内存...";
    }

    const sampleHintEl = container.querySelector<HTMLElement>("#system-cpu-sample-hint");
    if (sampleHintEl) {
      sampleHintEl.textContent = cpuSamplingHint;
    }

    // 更新采集耗时
    const elapsedEl = container.querySelector<HTMLElement>("#system-snapshot-elapsed");
    if (elapsedEl) {
      elapsedEl.textContent = `${response.elapsedMs}ms`;
    }

    // 更新健康状态徽章
    const healthCard = Array.from(container.querySelectorAll<HTMLElement>(".card")).find((card) => {
      const title = card.querySelector("h3")?.textContent?.trim();
      return title === "健康状态";
    });

    if (healthCard) {
      const badges = healthCard.querySelectorAll<HTMLElement>(".badge");
      if (badges.length >= 2) {
        badges[0].className = `badge ${getBadgeClassByUsage(cpuUsagePercent)}`;
        badges[0].textContent = formatPercent(cpuUsagePercent, true);
        badges[1].className = `badge ${getBadgeClassByUsage(memoryUsagePercent)}`;
        badges[1].textContent = formatPercent(memoryUsagePercent, true);
      }
    }

    updateSystemTrendWidgets(container, systemState.trendState, cpuUsagePercent, memoryUsagePercent);
  }

  /**
   * 渲染锚定的运行时长
   */
  renderAnchoredUptimeIfVisible(): void {
    if (appState.currentPage !== "system" || !systemState.appIsVisible) {
      return;
    }

    const container = document.getElementById("content");
    if (!container || !container.querySelector("#system-dashboard")) {
      return;
    }

    const metricValues = container.querySelectorAll<HTMLElement>(".metric-card .metric-value");
    if (metricValues.length >= 4) {
      metricValues[3].textContent = formatUptime(systemState.getAnchoredUptimeSeconds());
    }
  }

  private buildCpuSamplingHint(snapshot: Pick<SystemSnapshot, "sampleMode" | "sampledAtMs" | "isStale">): string {
    const modeLabel = snapshot.sampleMode === "precise" ? "精确采样" : "快速采样";
    const freshness = snapshot.isStale ? "缓存回退" : "实时";
    const sampledAt = snapshot.sampledAtMs
      ? new Date(snapshot.sampledAtMs).toLocaleTimeString("zh-CN", { hour12: false })
      : "--:--:--";
    return `${modeLabel} · ${freshness} · ${sampledAt}`;
  }

  private bindCpuSamplingHintTrigger(container: HTMLElement): void {
    const trigger = container.querySelector<HTMLElement>("[data-cpu-tip-trigger]");
    if (!trigger) {
      return;
    }

    trigger.addEventListener("click", () => {
      this.openCpuSamplingModal();
    });
  }

  private openCpuSamplingModal(): void {
    const modal = this.ensureCpuSamplingModal();
    modal.classList.add("is-open");
  }

  private closeCpuSamplingModal(): void {
    const modal = document.getElementById("cpu-sampling-modal");
    if (!modal) {
      return;
    }

    modal.classList.remove("is-open");
  }

  private ensureCpuSamplingModal(): HTMLElement {
    const existing = document.getElementById("cpu-sampling-modal");
    if (existing) {
      return existing;
    }

    const modal = document.createElement("div");
    modal.id = "cpu-sampling-modal";
    modal.className = "cpu-sampling-modal";
    modal.innerHTML = `
      <div class="cpu-sampling-modal-backdrop" data-cpu-modal-close="true"></div>
      <div class="cpu-sampling-modal-content" role="dialog" aria-modal="true" aria-labelledby="cpu-sampling-modal-title">
        <div class="cpu-sampling-modal-head">
          <h3 id="cpu-sampling-modal-title" class="text-lg font-semibold text-text-primary">CPU 采样说明</h3>
          <button type="button" class="btn btn-secondary cpu-sampling-modal-close" data-cpu-modal-close="true">关闭</button>
        </div>
        <div class="cpu-sampling-modal-body text-sm text-text-secondary">
          <p>当前策略优先使用 <span class="text-text-primary">Processor Utility</span>（更接近任务管理器），失败时回退到 <span class="text-text-primary">Processor Time</span>。</p>
          <p>首次进入可能先显示快速采样，随后会自动切换为精确采样结果。</p>
          <p>因采样窗口与取样时点不同，CPU 数值出现 2%-5% 波动属于正常现象。</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    if (!this.cpuHintModalEventsBound) {
      modal.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.dataset.cpuModalClose === "true") {
          this.closeCpuSamplingModal();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.closeCpuSamplingModal();
        }
      });

      this.cpuHintModalEventsBound = true;
    }

    return modal;
  }

  private shouldShowOverviewLoading(snapshot: SystemSnapshot): boolean {
    const missingCpuTopology = snapshot.cpuCores <= 0 || snapshot.cpuLogicalCores <= 0;
    const missingMemory = snapshot.totalMemoryGb <= 0;
    return (snapshot.isStale === true || snapshot.sampleMode === "quick") && (missingCpuTopology || missingMemory);
  }

  private buildCpuTopologyText(snapshot: Pick<SystemSnapshot, "cpuCores" | "cpuLogicalCores">): string {
    if (snapshot.cpuCores <= 0 && snapshot.cpuLogicalCores <= 0) {
      return "正在采集中...";
    }

    const physical = snapshot.cpuCores > 0 ? `${snapshot.cpuCores}核` : "--核";
    const logical = snapshot.cpuLogicalCores > 0 ? `${snapshot.cpuLogicalCores}线程` : "--线程";
    return `${physical}/${logical}`;
  }
}

/** 全局 System 页面实例 */
export const systemPage = new SystemPage();
