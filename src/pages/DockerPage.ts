/**
 * Docker 页面渲染模块
 */

import { dockerState, appState } from "../state";
import { dockerService } from "../services";
import {
  getDockerActionButton,
  getDockerEmptyState,
  getDockerLoadingState,
  getDockerPanelSkeleton,
  getDockerSummarySkeletonCards,
  getMetricCard,
} from "../ui";
import { filterDockerContainers, isContainerRunning } from "../modules/docker-data";
import { escapeHtml, formatPercent, getBadgeClassByUsage, getProgressColorClass } from "../utils/formatters";
import { DOCKER_SEARCH_DEBOUNCE_MS } from "../constants/config";
import { debounce } from "../utils/debounce";
import { MemoryMonitor } from "../utils/memory-monitor";
import type { DockerPanelTab } from "../types";
import type { DockerOverviewMode } from "../services/docker-service";

interface ManagedListenerEntry {
  element: Element;
  event: string;
  handler: EventListener;
}

/**
 * Docker 页面渲染类
 */
export class DockerPage {
  private summaryCardsCache: string | null = null;

  private lastSummaryFingerprint: string | null = null;

  private pageListeners: ManagedListenerEntry[] = [];

  private rowListeners: ManagedListenerEntry[] = [];

  private memoryMonitorTimer: number | null = null;

  private panelUpdateRafId: number | null = null;

  private readonly debouncedUpdatePanel = debounce(() => {
    this.requestPanelSectionUpdate();
  }, DOCKER_SEARCH_DEBOUNCE_MS);

  /**
   * 渲染 Docker 页面
   */
  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "docker")) {
      return;
    }

    const hasNoData = !this.hasOverviewData();
    const showBootstrapSkeleton = this.shouldRenderBootstrapSkeleton();
    const summaryDisplay = this.getSummaryDisplayValues();
    const lastCommand = dockerState.dashboard.lastCommand || "尚未执行";
    const pendingText = dockerState.pendingAction ? `执行中: ${dockerState.pendingAction}` : "空闲";
    const infoLine = dockerState.dashboard.infoText || "未获取 docker info";
    const versionLine = dockerState.dashboard.versionText || "未获取 docker version";

    container.innerHTML = `
    <div class="space-y-4 docker-page">
      <div id="docker-summary-grid" class="grid grid-cols-5 gap-3">
        ${showBootstrapSkeleton ? getDockerSummarySkeletonCards() : this.renderSummaryCards()}
      </div>

      <div class="grid grid-cols-4 gap-4">
        <div class="card col-span-3 animate-fade-in">
          <h3 class="text-lg font-semibold text-text-primary mb-3">Docker 操作中心</h3>

          <div class="docker-toolbar mb-3">
            ${getDockerActionButton("version", "版本", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("info", "信息", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("ps", "容器列表", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("images", "镜像列表", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("stats", "资源统计", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("system_df", "磁盘占用", { pendingAction: dockerState.pendingAction })}
            ${getDockerActionButton("compose_ls", "Compose 项目", { pendingAction: dockerState.pendingAction })}
          </div>

          <div class="docker-input-group mb-3">
            <label class="text-sm text-text-secondary">容器名称 / ID</label>
            <div class="docker-target-row mt-2">
              <input id="docker-target" class="input flex-1" placeholder="例如: redis-dev" value="${escapeHtml(dockerState.target)}" />
              ${getDockerActionButton("start", "启动", { pendingAction: dockerState.pendingAction })}
              ${getDockerActionButton("stop", "停止", { pendingAction: dockerState.pendingAction })}
              ${getDockerActionButton("restart", "重启", { pendingAction: dockerState.pendingAction })}
              ${getDockerActionButton("logs", "日志", { pendingAction: dockerState.pendingAction })}
            </div>
          </div>

          <div class="docker-panel-tools mb-3">
            <div class="docker-tabs">
              <button class="docker-tab ${dockerState.activeTab === "containers" ? "active" : ""}" data-docker-tab="containers">容器</button>
              <button class="docker-tab ${dockerState.activeTab === "images" ? "active" : ""}" data-docker-tab="images">镜像</button>
              <button class="docker-tab ${dockerState.activeTab === "stats" ? "active" : ""}" data-docker-tab="stats">资源监控</button>
              <button class="docker-tab ${dockerState.activeTab === "compose" ? "active" : ""}" data-docker-tab="compose">Compose</button>
            </div>

            <div class="docker-filters">
              <input id="docker-search" class="input" placeholder="筛选容器/镜像/服务..." value="${escapeHtml(dockerState.filters.search)}" />
              <select id="docker-status-filter" class="select">
                <option value="all" ${dockerState.filters.status === "all" ? "selected" : ""}>全部状态</option>
                <option value="running" ${dockerState.filters.status === "running" ? "selected" : ""}>仅运行中</option>
                <option value="exited" ${dockerState.filters.status === "exited" ? "selected" : ""}>仅已停止</option>
              </select>
              <button id="docker-refresh-overview" class="btn btn-secondary" ${dockerState.pendingAction ? "disabled" : ""}>刷新概览</button>
            </div>
          </div>

          <div id="docker-structured-panel">
            ${showBootstrapSkeleton ? getDockerPanelSkeleton() : this.renderStructuredPanel()}
          </div>

          <details class="docker-raw-panel">
            <summary>原始命令输出（调试）</summary>
            <div id="docker-output" class="docker-output custom-scrollbar">${escapeHtml(dockerState.output)}</div>
          </details>
        </div>

        <div class="card animate-fade-in docker-side-panel">
          <h3 class="text-lg font-semibold text-text-primary mb-3">执行状态</h3>
          <div class="space-y-3 text-sm text-text-secondary">
            <div class="docker-side-meta">
              <span>状态</span>
              <span id="docker-status" class="badge badge-info">${escapeHtml(dockerState.status)}</span>
            </div>
            <div class="docker-side-meta">
              <span>任务</span>
              <span id="docker-pending" class="text-text-primary">${escapeHtml(pendingText)}</span>
            </div>
            <div class="docker-side-meta">
              <span>最后命令</span>
            </div>
            <code id="docker-last-command" class="docker-last-command">${escapeHtml(lastCommand)}</code>

            <div class="docker-split"></div>

            <div class="docker-side-meta">
              <span>版本</span>
              <span id="docker-version-line" class="text-text-primary">${escapeHtml(versionLine)}</span>
            </div>
            <div class="docker-side-meta">
              <span>信息</span>
              <span id="docker-info-line" class="text-text-primary">${escapeHtml(infoLine)}</span>
            </div>

            <div class="docker-split"></div>

            <div class="docker-side-meta">
              <span>Compose 项目</span>
              <span id="docker-compose-count" class="docker-highlight">${summaryDisplay.composeCount}</span>
            </div>
            <div class="docker-side-meta">
              <span>平均 CPU</span>
              <span id="docker-avg-cpu" class="docker-highlight">${summaryDisplay.avgCpu}</span>
            </div>
            <div class="docker-side-meta">
              <span>网络接收</span>
              <span id="docker-net-rx" class="docker-highlight">${escapeHtml(summaryDisplay.netRx)}</span>
            </div>
            <div class="docker-side-meta">
              <span>网络发送</span>
              <span id="docker-net-tx" class="docker-highlight">${escapeHtml(summaryDisplay.netTx)}</span>
            </div>

            <div class="text-xs text-text-muted">结构化表格用于日常查看，原始输出保留在折叠面板便于排错。</div>
          </div>
        </div>
      </div>
    </div>
  `;

    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "docker")) {
      return;
    }

    this.bindDockerActions();
    dockerState.panelNeedsRefresh = false;

    // 首次进入或数据为空时自动刷新
    if (!dockerState.bootstrapped || hasNoData) {
      dockerState.bootstrapped = true;
      setTimeout(() => {
        void this.refreshOverviewWithUiSync("quick");
      }, 100);
    }

    if (import.meta.env.DEV) {
      MemoryMonitor.getInstance().checkMemoryThreshold(80, "After DockerPage render");
    }

    this.startMemoryMonitoring();
  }

  /**
   * 渲染摘要卡片
   */
  renderSummaryCards(): string {
    const summary = dockerState.dashboard.summary;
    const summaryFingerprint = this.buildSummaryFingerprint();

    if (this.summaryCardsCache !== null && this.lastSummaryFingerprint === summaryFingerprint) {
      return this.summaryCardsCache;
    }

    const cards = dockerState.lastOverviewAt === 0
      ? this.renderSummaryPlaceholderCards(this.isOverviewLoading())
      : getMetricCard("容器总数", String(summary.totalContainers), "包含运行中与停止实例", "") +
        getMetricCard("运行中", String(summary.runningContainers), "当前处于 Up 状态", "metric-trend-up") +
        getMetricCard("镜像数", String(summary.totalImages), "本地镜像存量", "") +
        getMetricCard("CPU 总占用", formatPercent(summary.totalCpuPercent), "容器资源总览", "") +
        getMetricCard(
          "内存占用",
          summary.memUsageText,
          summary.totalMemUsagePercent === null ? "执行 stats 后可见" : `占比 ${formatPercent(summary.totalMemUsagePercent)}`,
          ""
        );

    this.summaryCardsCache = cards;
    this.lastSummaryFingerprint = summaryFingerprint;
    return cards;
  }

  private buildSummaryFingerprint(): string {
    const summary = dockerState.dashboard.summary;
    return `${summary.totalContainers}|${summary.runningContainers}|${summary.totalImages}|${summary.totalCpuPercent}|${summary.memUsageText}|${summary.totalMemUsagePercent ?? "none"}|${dockerState.lastOverviewAt}|${dockerState.pendingAction ?? "idle"}`;
  }

  private renderSummaryPlaceholderCards(isLoading: boolean): string {
    const subtitle = isLoading ? "正在获取概览..." : "等待首次概览完成";
    return (
      getMetricCard("容器总数", "--", subtitle, "") +
      getMetricCard("运行中", "--", subtitle, "") +
      getMetricCard("镜像数", "--", subtitle, "") +
      getMetricCard("CPU 总占用", "--", subtitle, "") +
      getMetricCard("内存占用", "待统计", subtitle, "")
    );
  }

  /**
   * 渲染结构化面板
   */
  renderStructuredPanel(): string {
    if (dockerState.activeTab === "containers") {
      return this.renderContainerPanel();
    }

    if (dockerState.activeTab === "images") {
      return this.renderImagePanel();
    }

    if (dockerState.activeTab === "stats") {
      return this.renderStatsPanel();
    }

    return this.renderComposePanel();
  }

  /**
   * 渲染容器面板
   */
  renderContainerPanel(): string {
    const rows = filterDockerContainers(dockerState.dashboard.containers, dockerState.filters);

    // 如果正在加载且没有数据
    if (rows.length === 0 && dockerState.pendingAction) {
      return getDockerLoadingState();
    }

    if (rows.length === 0) {
      return getDockerEmptyState("未匹配到容器数据，请先执行「容器列表」或「刷新概览」。");
    }

    const body = rows
      .map((item) => {
        const running = isContainerRunning(item.status);
        const statusClass = running ? "badge-success" : "badge-warning";
        const actionButton = running
          ? `<button class="btn btn-secondary btn-xs" data-docker-row-action="stop" data-docker-target="${escapeHtml(item.name)}">停止</button>`
          : `<button class="btn btn-secondary btn-xs" data-docker-row-action="start" data-docker-target="${escapeHtml(item.name)}">启动</button>`;

        return `
        <tr>
          <td><span class="text-text-primary">${escapeHtml(item.name)}</span><div class="text-xs text-text-muted">${escapeHtml(item.id)}</div></td>
          <td><span class="badge ${statusClass}">${escapeHtml(item.status)}</span></td>
          <td class="text-text-secondary">${escapeHtml(item.ports)}</td>
          <td>
            <div class="docker-row-actions">
              ${actionButton}
              <button class="btn btn-secondary btn-xs" data-docker-row-action="restart" data-docker-target="${escapeHtml(item.name)}">重启</button>
              <button class="btn btn-secondary btn-xs" data-docker-row-action="logs" data-docker-target="${escapeHtml(item.name)}">日志</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    return `
    <div class="docker-table-wrapper custom-scrollbar">
      <table class="docker-table">
        <thead>
          <tr>
            <th>容器</th>
            <th>状态</th>
            <th>端口映射</th>
            <th>快捷操作</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
  }

  /**
   * 渲染镜像面板
   */
  renderImagePanel(): string {
    const search = dockerState.filters.search.trim().toLowerCase();
    const rows = dockerState.dashboard.images.filter((item) => {
      if (!search) {
        return true;
      }

      return (
        item.repository.toLowerCase().includes(search) ||
        item.tag.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search)
      );
    });

    // 如果正在加载且没有数据
    if (rows.length === 0 && dockerState.pendingAction) {
      return getDockerLoadingState();
    }

    if (rows.length === 0) {
      return getDockerEmptyState("未匹配到镜像数据，请先执行「镜像列表」或「刷新概览」。");
    }

    return `
    <div class="docker-table-wrapper custom-scrollbar">
      <table class="docker-table">
        <thead>
          <tr>
            <th>仓库</th>
            <th>Tag</th>
            <th>ID</th>
            <th>大小</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
                <tr>
                  <td class="text-text-primary">${escapeHtml(item.repository)}</td>
                  <td>${escapeHtml(item.tag)}</td>
                  <td>${escapeHtml(item.id)}</td>
                  <td>${escapeHtml(item.size)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  }

  /**
   * 渲染统计面板
   */
  renderStatsPanel(): string {
    const search = dockerState.filters.search.trim().toLowerCase();
    const rows = dockerState.dashboard.stats.filter((item) => {
      if (!search) {
        return true;
      }

      return item.name.toLowerCase().includes(search);
    });

    // 如果正在加载且没有数据
    if (rows.length === 0 && dockerState.pendingAction) {
      return getDockerLoadingState();
    }

    if (rows.length === 0) {
      return getDockerEmptyState("未匹配到资源监控数据，请先执行「资源统计」或「刷新概览」。");
    }

    return `
    <div class="docker-stat-grid">
      ${rows
        .map((item) => {
          const memPercent = item.memUsagePercent ?? 0;
          const memWidth = Math.max(0, Math.min(100, memPercent));
          const memBadgeClass = item.memUsagePercent === null ? "badge-info" : getBadgeClassByUsage(memPercent);

          return `
            <div class="docker-stat-card">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-semibold text-text-primary">${escapeHtml(item.name)}</h4>
                <span class="badge ${getBadgeClassByUsage(item.cpuPercent)}">CPU ${escapeHtml(item.cpuText)}</span>
              </div>
              <div class="text-xs text-text-secondary mb-2">内存 ${escapeHtml(item.memUsageText)}</div>
              <div class="docker-progress mb-3">
                <div class="docker-progress-value ${getProgressColorClass(memPercent)}" style="width: ${memWidth}%"></div>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-text-secondary">内存占比</span>
                <span class="badge ${memBadgeClass}">${item.memUsagePercent === null ? "--" : formatPercent(item.memUsagePercent)}</span>
              </div>
              <div class="text-xs text-text-muted mt-2">网络 ${escapeHtml(item.netIoText)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
  }

  /**
   * 渲染 Compose 面板
   */
  renderComposePanel(): string {
    const search = dockerState.filters.search.trim().toLowerCase();
    const rows = dockerState.dashboard.compose.filter((item) => {
      if (!search) {
        return true;
      }

      return (
        item.name.toLowerCase().includes(search) ||
        item.status.toLowerCase().includes(search) ||
        item.configFiles.toLowerCase().includes(search)
      );
    });

    // 如果正在加载且没有数据
    if (rows.length === 0 && dockerState.pendingAction) {
      return getDockerLoadingState();
    }

    if (rows.length === 0) {
      return getDockerEmptyState("未匹配到 Compose 项目，请先执行「Compose 项目」或「刷新概览」。");
    }

    return `
    <div class="docker-table-wrapper custom-scrollbar">
      <table class="docker-table">
        <thead>
          <tr>
            <th>项目名</th>
            <th>状态</th>
            <th>配置文件</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
                <tr>
                  <td class="text-text-primary">${escapeHtml(item.name)}</td>
                  <td><span class="badge ${item.status.toLowerCase().includes("running") ? "badge-success" : "badge-warning"}">${escapeHtml(
                    item.status
                  )}</span></td>
                  <td class="text-xs text-text-secondary">${escapeHtml(item.configFiles)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  }

  /**
   * 绑定 Docker 交互事件
   */
  bindDockerActions(): void {
    this.removeManagedListeners(this.pageListeners);
    this.removeManagedListeners(this.rowListeners);

    const actionButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-action]");
    actionButtons.forEach((button) => {
      this.addManagedEventListener(this.pageListeners, button, "click", async () => {
        const action = button.dataset.dockerAction;
        if (!action) {
          return;
        }

        const target = dockerState.target.trim();
        const requiresTarget = action === "start" || action === "stop" || action === "restart" || action === "logs";
        await this.runDockerAction(action, requiresTarget ? target || undefined : undefined);
      });
    });

    const targetInput = document.getElementById("docker-target") as HTMLInputElement | null;
    this.addManagedEventListener(this.pageListeners, targetInput, "input", () => {
      if (!targetInput) {
        return;
      }

      dockerState.target = targetInput.value;
    });

    const searchInput = document.getElementById("docker-search") as HTMLInputElement | null;
    this.addManagedEventListener(this.pageListeners, searchInput, "input", () => {
      if (!searchInput) {
        return;
      }

      dockerState.filters.search = searchInput.value;
      this.debouncedUpdatePanel();
    });

    const statusFilter = document.getElementById("docker-status-filter") as HTMLSelectElement | null;
    this.addManagedEventListener(this.pageListeners, statusFilter, "change", () => {
      if (!statusFilter) {
        return;
      }

      const statusValue = statusFilter.value;
      if (statusValue !== "all" && statusValue !== "running" && statusValue !== "exited") {
        return;
      }

      dockerState.filters.status = statusValue;
      this.requestPanelSectionUpdate();
    });

    const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-tab]");
    tabButtons.forEach((button) => {
      this.addManagedEventListener(this.pageListeners, button, "click", () => {
        const tab = button.dataset.dockerTab as DockerPanelTab | undefined;
        if (!tab) {
          return;
        }

        dockerState.activeTab = tab;
        this.requestPanelSectionUpdate();
      });
    });

    const refreshOverviewBtn = document.getElementById("docker-refresh-overview");
    this.addManagedEventListener(this.pageListeners, refreshOverviewBtn, "click", () => {
      void this.refreshOverviewWithUiSync("quick");
    });

    this.bindDockerRowActions();
  }

  /**
   * 绑定行级操作按钮
   */
  bindDockerRowActions(): void {
    this.removeManagedListeners(this.rowListeners);

    const rowButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-row-action]");
    rowButtons.forEach((button) => {
      this.addManagedEventListener(this.rowListeners, button, "click", async () => {
        const action = button.dataset.dockerRowAction;
        const target = button.dataset.dockerTarget;
        if (!action || !target) {
          return;
        }

        dockerState.target = target;
        await this.runDockerAction(action, target);
      });
    });
  }

  /**
   * 执行 Docker 命令
   */
  async runDockerAction(action: string, target?: string): Promise<void> {
    const activeTabAtStart = dockerState.activeTab;

    dockerState.setPendingAction(action);
    dockerState.output = "执行中...";
    this.refreshPageView();

    try {
      const response = await dockerService.runDockerAction(action, target);

      if (!response.ok || !response.data) {
        dockerState.status = `失败 · ${response.elapsedMs}ms`;
        dockerState.output = `执行失败\n${response.error ?? "未知错误"}`;
        dockerState.dashboard.rawOutput = dockerState.output;
        return;
      }

      const result = response.data;
      const stderr = result.stderr ? `\n\n[stderr]\n${result.stderr}` : "";
      dockerState.output = `[${result.command}]\nexit=${result.exitCode}\n\n${result.stdout || "(无输出)"}${stderr}`;
      dockerState.status = `${result.exitCode === 0 ? "成功" : "失败"} · ${response.elapsedMs}ms`;

      const switchTab = this.resolveSwitchTab(action, activeTabAtStart);
      dockerService.applyActionResult(result, switchTab);

      if ((action === "start" || action === "stop" || action === "restart") && result.exitCode === 0) {
        void this.refreshOverviewWithUiSync("quick");
      }
    } catch (error) {
      dockerState.status = "异常";
      dockerState.output = `调用异常\n${String(error)}`;
      dockerState.dashboard.rawOutput = dockerState.output;
    } finally {
      dockerState.pendingAction = null;
      this.refreshPageView();
    }
  }

  /**
   * 判断是否需要切换 Tab
   */
  private resolveSwitchTab(action: string, activeTabAtStart: DockerPanelTab): boolean {
    const canSwitchTabByAction = action === "ps" || action === "images" || action === "stats" || action === "compose_ls";
    if (!canSwitchTabByAction) {
      return false;
    }

    return dockerState.activeTab === activeTabAtStart;
  }

  /**
   * 更新面板区域
   */
  updatePanelSection(): void {
    if (appState.currentPage !== "docker") {
      return;
    }

    const showBootstrapSkeleton = this.shouldRenderBootstrapSkeleton();

    const panel = document.getElementById("docker-structured-panel");
    if (panel) {
      const nextMarkup = showBootstrapSkeleton ? getDockerPanelSkeleton() : this.renderStructuredPanel();
      if (panel.innerHTML !== nextMarkup) {
        // 先移除旧的行级监听器，避免内存泄漏
        this.removeManagedListeners(this.rowListeners);
        panel.innerHTML = nextMarkup;
        if (!showBootstrapSkeleton) {
          this.bindDockerRowActions();
        }
      }
    }

    const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-tab]");
    tabButtons.forEach((button) => {
      const tab = button.dataset.dockerTab;
      button.classList.toggle("active", tab === dockerState.activeTab);
    });

    dockerState.panelNeedsRefresh = false;
  }

  /**
   * 刷新页面视图
   */
  refreshPageView(): void {
    if (appState.currentPage !== "docker") {
      return;
    }

    const contentEl = document.getElementById("content");
    if (!contentEl) {
      return;
    }

    const statusEl = document.getElementById("docker-status");
    const outputEl = document.getElementById("docker-output");
    const structuredPanel = document.getElementById("docker-structured-panel");

    if (!statusEl || !outputEl || !structuredPanel) {
      void this.render(contentEl);
      return;
    }

    const summaryDisplay = this.getSummaryDisplayValues();
    const showBootstrapSkeleton = this.shouldRenderBootstrapSkeleton();

    // 批量更新 DOM（减少重排）
    const updates = [
      { el: statusEl, value: dockerState.status },
      { el: outputEl, value: dockerState.output },
      { el: document.getElementById("docker-pending"), value: dockerState.pendingAction ? `执行中: ${dockerState.pendingAction}` : "空闲" },
      { el: document.getElementById("docker-last-command"), value: dockerState.dashboard.lastCommand || "尚未执行" },
      { el: document.getElementById("docker-version-line"), value: dockerState.dashboard.versionText || "未获取 docker version" },
      { el: document.getElementById("docker-info-line"), value: dockerState.dashboard.infoText || "未获取 docker info" },
      { el: document.getElementById("docker-compose-count"), value: summaryDisplay.composeCount },
      { el: document.getElementById("docker-avg-cpu"), value: summaryDisplay.avgCpu },
      { el: document.getElementById("docker-net-rx"), value: summaryDisplay.netRx },
      { el: document.getElementById("docker-net-tx"), value: summaryDisplay.netTx },
    ];

    updates.forEach(({ el, value }) => {
      if (el && el.textContent !== value) {
        el.textContent = value;
      }
    });

    const summaryGrid = document.getElementById("docker-summary-grid");
    if (summaryGrid) {
      const nextSummary = showBootstrapSkeleton ? getDockerSummarySkeletonCards() : this.renderSummaryCards();
      if (summaryGrid.innerHTML !== nextSummary) {
        summaryGrid.innerHTML = nextSummary;
      }
    }

    if (dockerState.panelNeedsRefresh || showBootstrapSkeleton) {
      const nextPanel = showBootstrapSkeleton ? getDockerPanelSkeleton() : this.renderStructuredPanel();
      if (structuredPanel.innerHTML !== nextPanel) {
        this.removeManagedListeners(this.rowListeners);
        structuredPanel.innerHTML = nextPanel;
        if (!showBootstrapSkeleton) {
          this.bindDockerRowActions();
        }
      }
      dockerState.panelNeedsRefresh = false;
    }

    this.syncActionButtons();
  }

  private hasOverviewData(): boolean {
    return (
      dockerState.dashboard.containers.length > 0 ||
      dockerState.dashboard.images.length > 0 ||
      dockerState.dashboard.stats.length > 0 ||
      dockerState.dashboard.compose.length > 0 ||
      dockerState.lastOverviewAt > 0
    );
  }

  private isOverviewLoading(): boolean {
    return dockerState.pendingAction === "quick-overview" || dockerState.pendingAction === "overview";
  }

  private shouldRenderBootstrapSkeleton(): boolean {
    if (dockerState.lastOverviewAt > 0) {
      return false;
    }

    return !dockerState.bootstrapped || this.isOverviewLoading();
  }

  private getSummaryDisplayValues(): { composeCount: string; avgCpu: string; netRx: string; netTx: string } {
    if (dockerState.lastOverviewAt === 0) {
      if (this.isOverviewLoading()) {
        return {
          composeCount: "...",
          avgCpu: "...",
          netRx: "加载中",
          netTx: "加载中",
        };
      }

      return {
        composeCount: "--",
        avgCpu: "--",
        netRx: "待获取",
        netTx: "待获取",
      };
    }

    return {
      composeCount: String(dockerState.dashboard.summary.composeProjects),
      avgCpu: formatPercent(dockerState.dashboard.summary.avgCpuPercent),
      netRx: dockerState.dashboard.summary.netRxText,
      netTx: dockerState.dashboard.summary.netTxText,
    };
  }

  private async refreshOverviewWithUiSync(mode: DockerOverviewMode = "quick"): Promise<void> {
    if (appState.currentPage === "docker") {
      dockerState.panelNeedsRefresh = true;
      this.refreshPageView();
    }

    await dockerService.refreshOverview(mode);

    if (appState.currentPage === "docker") {
      dockerState.panelNeedsRefresh = true;
      this.refreshPageView();
    }
  }

  private addManagedEventListener(
    bucket: ManagedListenerEntry[],
    element: Element | null,
    event: string,
    handler: EventListener
  ): void {
    if (!element) {
      return;
    }

    element.addEventListener(event, handler);
    bucket.push({ element, event, handler });
  }

  private removeManagedListeners(bucket: ManagedListenerEntry[]): void {
    for (const listener of bucket) {
      listener.element.removeEventListener(listener.event, listener.handler);
    }

    bucket.length = 0;
  }

  private startMemoryMonitoring(): void {
    if (!import.meta.env.DEV || this.memoryMonitorTimer !== null) {
      return;
    }

    this.memoryMonitorTimer = MemoryMonitor.getInstance().startMonitoring(10_000);
  }

  private requestPanelSectionUpdate(): void {
    if (this.panelUpdateRafId !== null) {
      return;
    }

    this.panelUpdateRafId = window.requestAnimationFrame(() => {
      this.panelUpdateRafId = null;
      this.updatePanelSection();
    });
  }

  cleanup(): void {
    this.removeManagedListeners(this.pageListeners);
    this.removeManagedListeners(this.rowListeners);

    this.debouncedUpdatePanel.cancel();

    if (this.panelUpdateRafId !== null) {
      window.cancelAnimationFrame(this.panelUpdateRafId);
      this.panelUpdateRafId = null;
    }

    if (this.memoryMonitorTimer !== null) {
      MemoryMonitor.getInstance().stopMonitoring(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }

    this.summaryCardsCache = null;
    this.lastSummaryFingerprint = null;

    if (import.meta.env.DEV) {
      MemoryMonitor.getInstance().logMemorySnapshot("DockerPage cleanup");
    }
  }

  /**
   * 同步操作按钮状态
   */
  private syncActionButtons(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>("[data-docker-action]");
    buttons.forEach((button) => {
      const action = button.dataset.dockerAction;
      const label = button.dataset.label ?? button.textContent ?? "执行";
      if (!action) {
        return;
      }

      const isBusy = dockerState.pendingAction !== null;
      const isRunning = dockerState.pendingAction === action;
      button.disabled = isBusy;
      button.classList.toggle("is-running", isRunning);
      button.textContent = isRunning ? "执行中..." : label;
    });
  }
}

/** 全局 Docker 页面实例 */
export const dockerPage = new DockerPage();
