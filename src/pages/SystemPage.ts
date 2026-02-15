/**
 * System 页面渲染模块
 */

import { systemState, appState } from "../state";
import { systemService } from "../services";
import { getMetricCard } from "../ui";
import { getSystemTrendCardsHtml, updateSystemTrendWidgets } from "../modules/system-trend-view";
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
    const hasDashboard = container.querySelector("#system-dashboard") !== null;
    const hasSnapshotCache = systemState.snapshotCache !== null;

    if (!hasSnapshotCache && !hasDashboard) {
      if (systemState.bootstrapStartedAt <= 0) {
        systemState.bootstrapStartedAt = Date.now();
      }
      systemState.bootstrapStatus = "loading";
      systemState.bootstrapError = null;
      this.renderBootstrapState(container, {
        kind: "loading",
        title: "正在采集系统信息",
        detail: "首次采样可能需要几秒，期间可继续操作其他页面。",
      });
    }

    const snapshotFresh = systemService.isSnapshotFresh();

    // 如果有缓存，立即显示
    if (systemState.snapshotCache && !hasDashboard) {
      this.renderWithSnapshot(container, systemState.snapshotCache, 0);
      this.renderAnchoredUptimeIfVisible();
      systemState.bootstrapStatus = snapshotFresh ? "ready" : "partial";
      systemState.bootstrapError = snapshotFresh ? null : "当前使用缓存数据，后台正在同步最新指标";
    }

    if (snapshotFresh) {
      systemState.bootstrapStatus = "ready";
      systemState.bootstrapError = null;
      systemState.bootstrapStartedAt = 0;
      return;
    }

    // 异步获取新数据（不阻塞UI）
    const response = await systemService.fetchSystemSnapshot();
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "system")) {
      return;
    }

    if (!response.ok || !response.data) {
      const errorMessage = response.error ?? "未知错误";

      // 如果有缓存，保持显示缓存；否则显示错误
      if (systemState.snapshotCache) {
        this.renderWithSnapshot(container, systemState.snapshotCache, 0);
        this.renderAnchoredUptimeIfVisible();
        systemState.bootstrapStatus = "partial";
        systemState.bootstrapError = errorMessage;
      } else {
        // Error 态粘住：避免重复渲染同一错误状态
        const currentKind = container.querySelector<HTMLElement>("#system-bootstrap-state")?.dataset.bootstrapKind;
        if (currentKind !== "error" || systemState.bootstrapError !== errorMessage) {
          systemState.bootstrapStatus = "error";
          systemState.bootstrapError = errorMessage;
          this.renderBootstrapState(container, {
            kind: "error",
            title: "系统信息获取失败",
            detail: errorMessage,
            showRetry: true,
          });
        }
      }
      return;
    }

    systemState.bootstrapStatus = "ready";
    systemState.bootstrapError = null;
    systemState.bootstrapStartedAt = 0;

    const hasRenderedDashboard = container.querySelector("#system-dashboard") !== null;
    if (hasRenderedDashboard) {
      this.patchDashboardWithSnapshot(container, response.data, response.elapsedMs);
      this.renderAnchoredUptimeIfVisible();
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
    const overviewLoadingBlock = this.getOverviewLoadingBlock(shouldShowOverviewLoading);

    const topCards = [
      getMetricCard("CPU 占用", formatPercent(cpuUsagePercent, true), cpuSamplingHint, "metric-trend-up", true),
      getMetricCard("内存占用", memoryValueText, memorySubtitleText, "", false),
      getMetricCard("磁盘分区", diskCardValue, diskCardSubtitle, "", false),
      getMetricCard("运行时长", formatUptime(snapshot.uptimeSeconds), "系统启动至今", "metric-trend-up", false),
    ].join("");

    const trendCards = getSystemTrendCardsHtml(systemState.trendState);

    const diskBlocks = this.buildDiskBlocks(snapshot, shouldShowOverviewLoading);

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

      <div id="disk-grid" class="grid grid-cols-3 gap-4">${diskBlocks}</div>
    </div>
  `;

    this.bindCpuSamplingHintTrigger(container);
  }

  /**
   * 已渲染仪表盘时，执行无闪烁局部回填
   */
  private patchDashboardWithSnapshot(container: HTMLElement, snapshot: SystemSnapshot, elapsedMs: number): void {
    if (!container.querySelector("#system-dashboard")) {
      this.renderWithSnapshot(container, snapshot, elapsedMs);
      return;
    }

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

    const metricValues = container.querySelectorAll<HTMLElement>(".metric-card .metric-value");
    if (metricValues.length >= 4) {
      metricValues[0].textContent = formatPercent(cpuUsagePercent, true);
      metricValues[1].textContent = memoryValueText;
      metricValues[2].textContent = diskCardValue;
      metricValues[3].textContent = formatUptime(snapshot.uptimeSeconds);
    }

    const metricSubtitles = container.querySelectorAll<HTMLElement>(".metric-card .text-xs");
    if (metricSubtitles.length >= 4) {
      metricSubtitles[0].textContent = cpuSamplingHint;
      metricSubtitles[1].textContent = memorySubtitleText;
      metricSubtitles[2].textContent = diskCardSubtitle;
      metricSubtitles[3].textContent = "系统启动至今";
    }

    this.patchOverviewField(container, "主机名", snapshot.hostName || "未知");
    this.patchOverviewField(container, "操作系统", snapshot.osName || "未知");
    this.patchOverviewField(
      container,
      "版本",
      `${snapshot.osVersion || "未知"}${snapshot.buildNumber ? ` (build ${snapshot.buildNumber})` : ""}`
    );
    this.patchOverviewField(container, "架构", snapshot.architecture || "未知");
    this.patchOverviewField(container, "CPU", snapshot.cpuModel || "未知", snapshot.cpuModel || "未知");
    this.patchOverviewField(container, "CPU 核心", cpuTopologyText);
    this.patchOverviewField(container, "采样模式", cpuSamplingHint);

    const sampleHintEl = container.querySelector<HTMLElement>("#system-cpu-sample-hint");
    if (sampleHintEl) {
      sampleHintEl.textContent = cpuSamplingHint;
    }

    const elapsedEl = container.querySelector<HTMLElement>("#system-snapshot-elapsed");
    if (elapsedEl) {
      elapsedEl.textContent = elapsedMs > 0 ? `${elapsedMs}ms` : "--";
    }

    this.syncOverviewLoadingState(container, shouldShowOverviewLoading);

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

    const diskGrid = container.querySelector<HTMLElement>("#disk-grid");
    if (diskGrid) {
      const nextDiskHtml = this.buildDiskBlocks(snapshot, shouldShowOverviewLoading);
      if (diskGrid.innerHTML !== nextDiskHtml) {
        diskGrid.innerHTML = nextDiskHtml;
      }
    }

    updateSystemTrendWidgets(container, systemState.trendState, cpuUsagePercent, memoryUsagePercent);
  }

  private patchOverviewField(container: HTMLElement, labelText: string, valueText: string, title?: string): void {
    const overviewRows = container.querySelectorAll<HTMLElement>(".card.col-span-2 .space-y-3 .flex.justify-between");
    for (const row of overviewRows) {
      const label = row.querySelector(".text-text-secondary")?.textContent?.trim();
      if (label !== labelText) {
        continue;
      }

      const valueEl = row.querySelector<HTMLElement>(".text-text-primary");
      if (!valueEl) {
        continue;
      }

      valueEl.textContent = valueText;
      if (title !== undefined) {
        valueEl.title = title;
      }
      return;
    }
  }

  private syncOverviewLoadingState(container: HTMLElement, shouldShowOverviewLoading: boolean): void {
    const overviewCard = container.querySelector<HTMLElement>(".card.col-span-2");
    if (!overviewCard) {
      return;
    }

    const existingLoading = overviewCard.querySelector<HTMLElement>(".system-overview-loading");
    if (shouldShowOverviewLoading) {
      if (existingLoading) {
        return;
      }

      const detailList = overviewCard.querySelector<HTMLElement>(".space-y-3");
      if (detailList) {
        detailList.insertAdjacentHTML("beforebegin", this.getOverviewLoadingBlock(true));
      }
      return;
    }

    if (existingLoading) {
      existingLoading.remove();
    }
  }

  private getOverviewLoadingBlock(shouldShowOverviewLoading: boolean): string {
    if (!shouldShowOverviewLoading) {
      return "";
    }

    return '<div class="system-overview-loading"><span class="system-overview-loading-dot" aria-hidden="true"></span><span>正在获取完整系统信息，请稍候...</span></div>';
  }

  private buildDiskBlocks(snapshot: SystemSnapshot, shouldShowOverviewLoading: boolean): string {
    if (snapshot.disks.length === 0) {
      return `<div class="card animate-fade-in col-span-3"><div class="text-sm text-text-secondary">${
        shouldShowOverviewLoading ? "磁盘信息采集中..." : "未检测到磁盘分区信息"
      }</div></div>`;
    }

    return snapshot.disks
      .map((disk) => `
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
        </div>`)
      .join("");
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

    // 缓存有完整数据后移除加载占位符、回填磁盘
    this.tryPatchOverviewLoading(container);
    this.tryPatchDiskSection(container);
  }

  /**
   * 精确采样到达后移除"正在获取完整系统信息"加载提示并补全概览数据
   */
  private tryPatchOverviewLoading(container: HTMLElement): void {
    const snapshot = systemState.snapshotCache;
    if (!snapshot || this.shouldShowOverviewLoading(snapshot)) {
      return;
    }

    const loadingEl = container.querySelector<HTMLElement>(".system-overview-loading");
    if (!loadingEl) {
      return; // 已经补全过了
    }

    loadingEl.remove();

    // 补全概览卡片中所有占位字段
    const patchMap: Record<string, string> = {
      "版本": `${escapeHtml(snapshot.osVersion || "未知")}${snapshot.buildNumber ? ` (build ${escapeHtml(snapshot.buildNumber)})` : ""}`,
      "CPU": escapeHtml(snapshot.cpuModel || "未知"),
      "CPU 核心": this.buildCpuTopologyText(snapshot),
    };

    const overviewRows = container.querySelectorAll<HTMLElement>(".card.col-span-2 .space-y-3 .flex.justify-between");
    for (const row of overviewRows) {
      const label = row.querySelector(".text-text-secondary")?.textContent?.trim();
      if (!label) continue;

      const newValue = patchMap[label];
      if (newValue === undefined) continue;

      const valueEl = row.querySelector(".text-text-primary");
      if (valueEl && (valueEl.textContent?.includes("未知") || valueEl.textContent?.includes("采集中"))) {
        valueEl.innerHTML = newValue;
      }
    }
  }

  /**
   * 磁盘数据回填：缓存已有磁盘数据但页面仍显示占位符时，局部更新磁盘区域
   */
  private tryPatchDiskSection(container: HTMLElement): void {
    const snapshot = systemState.snapshotCache;
    if (!snapshot) {
      return;
    }

    const diskGrid = container.querySelector<HTMLElement>("#disk-grid");
    if (!diskGrid) {
      return;
    }

    const nextDiskHtml = this.buildDiskBlocks(snapshot, this.shouldShowOverviewLoading(snapshot));
    if (diskGrid.innerHTML === nextDiskHtml) {
      return;
    }

    diskGrid.innerHTML = nextDiskHtml;
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

  private renderBootstrapState(
    container: HTMLElement,
    options: {
      kind: "loading" | "error";
      title: string;
      detail: string;
      showRetry?: boolean;
    }
  ): void {
    const kindClass = options.kind === "error" ? "is-error" : "is-loading";
    const retryButton = options.showRetry
      ? '<button id="system-retry-btn" type="button" class="btn btn-primary system-bootstrap-retry">立即重试</button>'
      : "";

    container.innerHTML = `
      <div id="system-bootstrap-state" class="card animate-fade-in system-bootstrap-state ${kindClass}" data-bootstrap-kind="${escapeHtml(
        options.kind
      )}">
        <div class="system-bootstrap-head">
          <span class="system-bootstrap-indicator" aria-hidden="true"></span>
          <h3 class="text-lg font-semibold text-text-primary">${escapeHtml(options.title)}</h3>
        </div>
        <p class="system-bootstrap-detail text-sm text-text-secondary">${escapeHtml(options.detail)}</p>
        <div class="system-bootstrap-actions">
          ${retryButton}
        </div>
      </div>
    `;
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
