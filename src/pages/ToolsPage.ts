/**
 * Tools 页面渲染模块
 */

import { toolsState, appState } from "../state";
import { toolsService } from "../services";
import { showLoading, showGlobalNotice } from "../modules/shell-ui";
import { marketMetaMap } from "../config/app-config";
import type { ToolStatus, MarketMeta, ToolFilterState } from "../types";
import { escapeHtml } from "../utils/formatters";
import { TOOL_SEARCH_DEBOUNCE_MS } from "../constants/config";

const INSTALL_PROGRESS_START = 8;
const INSTALL_PROGRESS_PREPARE = 18;
const INSTALL_PROGRESS_DISPATCH = 32;
const INSTALL_PROGRESS_HANDLE_RESPONSE = 62;
const INSTALL_PROGRESS_SYNC = 86;
const INSTALL_PROGRESS_SUCCESS = 100;
const INSTALL_PROGRESS_FAIL = 100;

/**
 * Tools 页面渲染类
 */
export class ToolsPage {
  private gridClickHandler: ((event: Event) => Promise<void>) | null = null;

  private async runRefreshWithSoftTimeout(
    container: HTMLElement,
    force: boolean,
    renderEpoch?: number
  ): Promise<Awaited<ReturnType<typeof toolsService.refreshCacheDetailed>>> {
    const refreshPromise = toolsService.refreshCacheDetailed(force);
    let timeoutHandle: number | null = null;

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = window.setTimeout(() => resolve("timeout"), toolsState.scanSoftTimeoutMs);
    });

    const raceResult = await Promise.race([refreshPromise.then(() => "done" as const), timeoutPromise]);

    if (
      raceResult === "timeout" &&
      toolsState.refreshing &&
      appState.currentPage === "tools" &&
      (renderEpoch === undefined || !appState.isRenderStale(renderEpoch, "tools"))
    ) {
      toolsState.scanSoftTimeoutActive = true;
      this.renderWithData(container);
    }

    try {
      return await refreshPromise;
    } finally {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * 渲染 Tools 页面
   */
  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    const hadSnapshot = toolsState.dataCache.length > 0;

    if (hadSnapshot) {
      this.renderWithData(container);
      this.scheduleAutoRefresh(renderEpoch);
      this.fetchAndUpdateDownloads();
      return;
    }

    showLoading(container, "正在探测本机开发环境...");
    const refreshResult = await this.runRefreshWithSoftTimeout(container, true, renderEpoch);
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "tools")) {
      return;
    }

    if (!refreshResult.ok && toolsState.dataCache.length === 0) {
      this.renderDetectErrorState(container, refreshResult.error ?? "无法获取工具状态");
      return;
    }

    this.renderWithData(container);
    if (!refreshResult.ok && refreshResult.error) {
      showGlobalNotice("环境探测失败", `${refreshResult.error}，当前展示缓存结果`, "error");
    }
    this.fetchAndUpdateDownloads();
  }

  /**
   * 使用数据渲染页面
   */
  renderWithData(container: HTMLElement): void {
    const installedCount = toolsState.dataCache.filter((item) => item.installed).length;
    const refreshStatus = this.buildRefreshStatusHtml();
    const changedText =
      toolsState.diffInstalled === 0 && toolsState.diffMissing === 0
        ? "无变化"
        : `+${toolsState.diffInstalled} / -${toolsState.diffMissing}`;

    container.innerHTML = `
    <div id="tools-market-root" class="space-y-4">
      <div class="grid grid-cols-5 gap-3">
        <div class="card metric-card"><div class="text-sm text-text-secondary">工具总数</div><div class="metric-value">${toolsState.dataCache.length}</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">已安装</div><div class="metric-value">${installedCount}</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">待安装</div><div class="metric-value">${
          toolsState.dataCache.length - installedCount
        }</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">检测耗时</div><div class="metric-value">${toolsState.lastScanElapsedMs}ms</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">与上次差异</div><div class="metric-value">${escapeHtml(changedText)}</div></div>
      </div>

      <div class="card animate-fade-in">
        <div class="flex items-center justify-between mb-4 gap-3">
          <h3 class="text-lg font-semibold text-text-primary">环境市场</h3>
          <div class="flex items-center gap-3 ml-auto">
            <div class="text-xs text-text-secondary">上次探测：${escapeHtml(
              toolsService.formatRelativeTime(toolsState.lastScanAt)
            )}</div>
            ${refreshStatus}
            <button id="tools-refresh-btn" class="btn btn-secondary" ${toolsState.refreshing ? "disabled" : ""}>${
              toolsState.refreshing ? "探测中..." : "重新探测"
            }</button>
          </div>
        </div>

        <div class="filter-bar">
          <div class="filter-search">
            <svg class="filter-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="tool-search" class="filter-search-input" type="search" placeholder="搜索技术栈、镜像、工具..." value="${escapeHtml(toolsState.filters.search)}" />
          </div>
          <div class="filter-row">
            <div class="filter-segment" role="radiogroup">
              <button class="filter-segment-item ${toolsState.filters.status === "all" ? "active" : ""}" data-status="all">全部</button>
              <button class="filter-segment-item ${toolsState.filters.status === "installed" ? "active" : ""}" data-status="installed">已安装</button>
              <button class="filter-segment-item ${toolsState.filters.status === "missing" ? "active" : ""}" data-status="missing">待安装</button>
            </div>
            <div class="filter-chips-wrap">
              <div class="filter-chips" role="radiogroup">
                <button class="filter-chip ${toolsState.filters.category === "all" ? "active" : ""}" data-category="all">全部</button>
                ${toolsState.categories.map((cat) => `<button class="filter-chip ${toolsState.filters.category === cat ? "active" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-4">
          <input id="install-path" class="input col-span-2" placeholder="安装路径（可选，如 D:/DevTools）" value="${escapeHtml(
            toolsState.installPath
          )}" />
          <button id="pick-install-path" class="btn btn-secondary">选择目录</button>
        </div>

        <div id="tools-grid-scroll" class="tools-grid-scroll custom-scrollbar">
          <div id="tools-grid" class="grid grid-cols-3 gap-4"></div>
        </div>
      </div>

      <div class="card animate-fade-in">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-semibold text-text-primary">操作日志</h3>
          <span id="install-status" class="text-xs text-text-secondary">${escapeHtml(toolsState.installState || "空闲")}</span>
        </div>
        <div id="install-log" class="install-log">${escapeHtml(toolsState.installLog)}</div>
      </div>
    </div>
  `;

    this.renderToolsGrid();
    this.bindToolPageActions();
  }

  private buildRefreshStatusHtml(): string {
    let label = "同步成功";
    let statusClass = "is-success";

    if (toolsState.refreshing) {
      label = "正在探测中";
      statusClass = "is-running";
      if (toolsState.scanSoftTimeoutActive) {
        label = "探测中（耗时较长，逐项加载中）";
      }
    } else if (toolsState.lastRefreshError) {
      const whenText = toolsState.lastRefreshErrorAt > 0
        ? toolsService.formatRelativeTime(toolsState.lastRefreshErrorAt)
        : "刚刚";
      label = toolsState.dataCache.length > 0
        ? `探测失败，已回退缓存（${whenText}）`
        : `探测失败（${whenText}）`;
      statusClass = "is-error";
    } else if (toolsState.lastScanAt > 0) {
      label = `同步成功（${toolsService.formatRelativeTime(toolsState.lastScanAt)}）`;
    }

    return `
      <span class="tools-refresh-pill ${statusClass}">
        <span class="tools-refresh-pill-dot" aria-hidden="true"></span>
        <span>${escapeHtml(label)}</span>
      </span>
    `;
  }

  private renderDetectErrorState(container: HTMLElement, detail: string): void {
    container.innerHTML = `
      <div class="card animate-fade-in tools-detect-error">
        <h3 class="text-lg font-semibold text-error mb-2">环境探测失败</h3>
        <p class="text-sm text-text-secondary mb-4">${escapeHtml(detail)}</p>
        <button id="tools-retry-btn" type="button" class="btn btn-primary">重新探测</button>
      </div>
    `;

    const retryBtn = container.querySelector<HTMLButtonElement>("#tools-retry-btn");
    if (!retryBtn) {
      return;
    }

    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "探测中...";

      try {
        const result = await this.runRefreshWithSoftTimeout(container, true);
        if (!result.ok && toolsState.dataCache.length === 0) {
          this.renderDetectErrorState(container, result.error ?? "环境探测失败，请稍后重试");
          return;
        }

        this.renderWithData(container);
        if (!result.ok && result.error) {
          showGlobalNotice("环境探测失败", `${result.error}，当前展示缓存结果`, "error");
        }
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = "重新探测";
      }
    });
  }

  /**
   * 渲染工具网格
   */
  renderToolsGrid(): void {
    const grid = document.getElementById("tools-grid");
    if (!grid) {
      return;
    }

    const filtered = this.filterTools(toolsState.dataCache, toolsState.filters);
    const renderToken = ++toolsState.gridRenderToken;

    if (filtered.length === 0) {
      if (toolsState.refreshing && toolsState.scanSoftTimeoutActive) {
        grid.innerHTML = this.buildToolPlaceholderCards();
        return;
      }

      grid.innerHTML = '<div class="card col-span-3">当前筛选条件无结果</div>';
      return;
    }

    grid.innerHTML = "";

    const renderBatch = (startIndex: number): void => {
      if (renderToken !== toolsState.gridRenderToken || appState.currentPage !== "tools") {
        return;
      }

      const endIndex = Math.min(startIndex + 12, filtered.length);
      const batchHtml = filtered
        .slice(startIndex, endIndex)
        .map((tool) => this.buildToolCardHtml(tool))
        .join("");

      if (batchHtml) {
        grid.insertAdjacentHTML("beforeend", batchHtml);
      }

      if (endIndex < filtered.length) {
        window.requestAnimationFrame(() => renderBatch(endIndex));
        return;
      }

      this.bindInstallButtons();
    };

    renderBatch(0);
  }

  /**
   * 构建工具卡片 HTML
   */
  buildToolCardHtml(tool: ToolStatus): string {
    const meta = this.getMarketMeta(tool);
    const installKey = tool.installKey ?? "";
    const canInstall = installKey.length > 0;
    const hasInstallingTask = toolsState.installingKey !== null;
    const hasUninstallingTask = toolsState.uninstallingKey !== null;
    const hasPendingTask = hasInstallingTask || hasUninstallingTask;
    const installing = hasInstallingTask && toolsState.installingKey === installKey;
    const uninstalling = hasUninstallingTask && toolsState.uninstallingKey === installKey;
    const isActive = installing || uninstalling;
    const currentProgress = isActive ? toolsState.installProgress : 0;
    const buttonText = tool.installed ? "重装" : "安装";
    const installDisabled = !canInstall || hasPendingTask;
    const installActionText = installing ? "安装中..." : hasPendingTask ? "等待中..." : buttonText;
    const uninstallDisabled = !canInstall || !tool.installed || hasPendingTask;
    const uninstallActionText = uninstalling ? "卸载中..." : "卸载";
    const showScanLoading = toolsState.refreshing && toolsState.scanSoftTimeoutActive;

    return `
    <div class="card market-card">
      <div class="flex items-center justify-between mb-3">
        <div class="market-header-icon">${escapeHtml(meta.title.slice(0, 1))}</div>
        <span class="badge badge-info">${escapeHtml(meta.type)}</span>
      </div>

      <h4 class="text-xl font-bold text-text-primary mb-2">${escapeHtml(meta.title)}</h4>
      <p class="text-sm text-text-secondary mb-3">${escapeHtml(meta.description)}</p>

      <div class="flex flex-wrap gap-2 mb-4">
        ${meta.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>

      <div class="text-xs text-text-secondary mb-4">
        <div class="mb-1">状态：<span class="badge ${tool.installed ? "badge-success" : "badge-error"}">
          ${tool.installed ? "已安装" : "未安装"}
        </span></div>
        <div class="mb-1">命令：${escapeHtml(tool.command)}</div>
        <div class="mb-1">版本：${escapeHtml(tool.version ?? "未检测到")}</div>
        <div class="mb-1">分类：${escapeHtml(tool.category)}</div>
        ${tool.installPath ? `<div class="mb-1 tool-install-path" title="${escapeHtml(tool.installPath)}">路径：${escapeHtml(tool.installPath)}</div>` : ""}
        ${tool.details ? `<div class="text-text-muted">详情：${escapeHtml(tool.details)}</div>` : ""}
      </div>

      <div class="text-xs text-text-muted mb-3">
        <span>↓ ${escapeHtml(meta.downloads)}</span>
      </div>

      <div class="flex gap-2">
        <button class="btn btn-install flex-1" data-install-key="${escapeHtml(installKey)}" ${
          installDisabled ? "disabled" : ""
        }>
          ${installActionText}
        </button>
        <button class="btn btn-uninstall flex-1" data-uninstall-key="${escapeHtml(installKey)}" ${
          uninstallDisabled ? "disabled" : ""
        }>
          ${uninstallActionText}
        </button>
      </div>

      ${
        showScanLoading
          ? `<div class="tool-scan-loading">
              <span class="tool-scan-loading-dot" aria-hidden="true"></span>
              <span>探测中，状态即将更新...</span>
            </div>`
          : ""
      }

      ${
        isActive
          ? `<div class="tool-install-progress" data-tool-progress="${escapeHtml(installKey)}" aria-label="${escapeHtml(
              meta.title
            )} 进度">
              <div class="tool-install-progress-status" data-tool-progress-status>${escapeHtml(
                toolsState.installMessage || (installing ? "安装中" : "卸载中")
              )}</div>
              <div class="tool-install-progress-row">
                <div class="tool-install-progress-track">
                  <div
                    class="tool-install-progress-value ${installing ? "is-install" : "is-uninstall"}"
                    data-tool-progress-value
                    style="width: ${Math.max(4, currentProgress)}%"
                  ></div>
                </div>
                <div class="tool-install-progress-text" data-tool-progress-text>${Math.round(currentProgress)}%</div>
              </div>
            </div>`
          : ""
      }
    </div>
  `;
  }

  private buildToolPlaceholderCards(): string {
    return Object.entries(marketMetaMap)
      .slice(0, 12)
      .map(([, meta]) => {
        return `
          <div class="card market-card market-card-placeholder">
            <div class="flex items-center justify-between mb-3">
              <div class="market-header-icon">${escapeHtml(meta.title.slice(0, 1))}</div>
              <span class="badge badge-info">${escapeHtml(meta.type)}</span>
            </div>

            <h4 class="text-xl font-bold text-text-primary mb-2">${escapeHtml(meta.title)}</h4>
            <p class="text-sm text-text-secondary mb-3">${escapeHtml(meta.description)}</p>

            <div class="tool-scan-loading tool-scan-loading-block">
              <span class="tool-scan-loading-dot" aria-hidden="true"></span>
              <span>探测中，正在读取安装状态...</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  /**
   * 绑定工具页面交互事件
   */
  bindToolPageActions(): void {
    const searchInput = document.getElementById("tool-search") as HTMLInputElement | null;
    const pathInput = document.getElementById("install-path") as HTMLInputElement | null;
    const refreshBtn = document.getElementById("tools-refresh-btn") as HTMLButtonElement | null;
    const pickPathBtn = document.getElementById("pick-install-path") as HTMLButtonElement | null;

    searchInput?.addEventListener("input", () => {
      toolsState.filters.search = searchInput.value;

      if (toolsState.searchDebounceTimer !== null) {
        window.clearTimeout(toolsState.searchDebounceTimer);
      }

      toolsState.searchDebounceTimer = window.setTimeout(() => {
        toolsState.searchDebounceTimer = null;
        this.renderToolsGrid();
      }, TOOL_SEARCH_DEBOUNCE_MS);
    });

    const segment = document.querySelector<HTMLElement>(".filter-segment");
    segment?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-segment-item");
      if (!btn || btn.classList.contains("active")) return;
      const status = btn.dataset.status as ToolFilterState["status"];
      if (!status) return;
      toolsState.filters.status = status;
      segment.querySelectorAll(".filter-segment-item").forEach((el) => {
        el.classList.toggle("active", el === btn);
      });
      this.renderToolsGrid();
    });

    const chipsContainer = document.querySelector<HTMLElement>(".filter-chips");
    const chipsWrap = document.querySelector<HTMLElement>(".filter-chips-wrap");
    chipsContainer?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-chip");
      if (!btn || btn.classList.contains("active")) return;
      const category = btn.dataset.category;
      if (category === undefined) return;
      toolsState.filters.category = category;
      chipsContainer.querySelectorAll(".filter-chip").forEach((el) => {
        el.classList.toggle("active", el === btn);
      });
      this.renderToolsGrid();
    });

    chipsContainer?.addEventListener("scroll", () => {
      if (!chipsContainer || !chipsWrap) return;
      const atEnd = chipsContainer.scrollLeft + chipsContainer.clientWidth >= chipsContainer.scrollWidth - 4;
      chipsWrap.classList.toggle("scrolled-end", atEnd);
    });

    pathInput?.addEventListener("input", () => {
      toolsState.installPath = pathInput.value;
    });

    refreshBtn?.addEventListener("click", async () => {
      if (toolsState.refreshing) {
        return;
      }

      const contentEl = document.getElementById("content") as HTMLElement | null;
      if (!contentEl) {
        return;
      }

      const result = await this.runRefreshWithSoftTimeout(contentEl, true);
      if (appState.currentPage !== "tools") {
        return;
      }

      if (!result.ok && toolsState.dataCache.length === 0) {
        this.renderDetectErrorState(contentEl, result.error ?? "环境探测失败");
        showGlobalNotice("环境探测失败", result.error ?? "请稍后重试", "error");
        return;
      }

      this.renderWithData(contentEl);
      if (!result.ok && result.error) {
        showGlobalNotice("环境探测失败", `${result.error}，当前展示缓存结果`, "error");
      } else if (result.retried) {
        showGlobalNotice("环境探测已恢复", "请求已自动重试并成功同步", "success", 2200);
      }
    });

    pickPathBtn?.addEventListener("click", async () => {
      pickPathBtn.disabled = true;
      try {
        const path = await toolsService.pickInstallDirectory();
        if (path) {
          toolsState.installPath = path;
          if (pathInput) {
            pathInput.value = path;
          }
        }
      } finally {
        pickPathBtn.disabled = false;
      }
    });

  }

  /**
   * 绑定安装按钮事件（使用事件委托，避免重复绑定）
   */
  bindInstallButtons(): void {
    const grid = document.getElementById("tools-grid");
    if (!grid) {
      return;
    }

    // 移除旧的事件监听器（如果存在）
    if (this.gridClickHandler) {
      grid.removeEventListener("click", this.gridClickHandler);
    }

    // 使用事件委托，在父容器上监听点击事件
    this.gridClickHandler = async (event: Event) => {
      const target = event.target as HTMLElement;

      // 检查是否点击了安装按钮
      const installButton = target.closest<HTMLButtonElement>("[data-install-key]");
      if (installButton && !installButton.disabled) {
        const key = installButton.dataset.installKey;
        if (key) {
          await this.installTool(key);
        }
        return;
      }

      // 检查是否点击了卸载按钮
      const uninstallButton = target.closest<HTMLButtonElement>("[data-uninstall-key]");
      if (uninstallButton && !uninstallButton.disabled) {
        const key = uninstallButton.dataset.uninstallKey;
        if (key) {
          await this.uninstallTool(key);
        }
        return;
      }
    };

    grid.addEventListener("click", this.gridClickHandler);
  }

  /**
   * 安装工具
   */
  async installTool(itemKey: string): Promise<void> {
    this.clearInstallProgressTimer();
    toolsState.installingKey = itemKey;
    toolsState.installState = `安装中：${itemKey}`;
    toolsState.installFeedbackLevel = "running";
    toolsState.installFeedbackTitle = "正在安装开发环境";
    toolsState.installFeedbackDetail = `已提交安装任务：${itemKey}`;
    toolsState.installMessage = "准备安装命令";
    toolsState.installProgress = INSTALL_PROGRESS_START;
    toolsState.appendLog(`\n>>> 开始安装 ${itemKey}`);
    this.renderToolsGrid();
    this.renderInstallState();
    this.startInstallProgressLoop();

    toolsState.installProgress = INSTALL_PROGRESS_PREPARE;
    toolsState.installMessage = "解析安装参数";
    this.renderInstallState();

    try {
      toolsState.installProgress = INSTALL_PROGRESS_DISPATCH;
      toolsState.installMessage = "执行安装命令";
      this.renderInstallState();

      const response = await toolsService.installTool(itemKey, toolsState.installPath);

      toolsState.installProgress = INSTALL_PROGRESS_HANDLE_RESPONSE;
      toolsState.installMessage = "处理安装结果";
      this.renderInstallState();

      if (!response.ok || !response.data) {
        this.clearInstallProgressTimer();
        toolsState.appendLog(`安装失败：${response.error ?? "未知错误"}`);
        toolsState.installState = "安装失败";
        toolsState.installFeedbackLevel = "error";
        toolsState.installFeedbackTitle = "安装失败";
        toolsState.installFeedbackDetail = response.error ?? "安装命令未返回有效数据";
        toolsState.installProgress = INSTALL_PROGRESS_FAIL;
        toolsState.installMessage = "安装失败";
        showGlobalNotice("安装失败", toolsState.installFeedbackDetail, "error");
        this.renderInstallState();
        return;
      }

      const result = response.data;
      toolsState.appendLog(`命令：${result.command}`);
      toolsState.appendLog(`返回码：${result.exitCode}`);
      if (result.stdout) {
        toolsState.appendLog(`stdout:\n${result.stdout}`);
      }
      if (result.stderr) {
        toolsState.appendLog(`stderr:\n${result.stderr}`);
      }

      if (result.exitCode === 0) {
        this.clearInstallProgressTimer();
        toolsState.installProgress = INSTALL_PROGRESS_SYNC;
        toolsState.installMessage = "同步最新安装状态";
        this.renderInstallState();

        await toolsService.refreshCache(true);

        toolsState.installState = "安装完成";
        toolsState.installFeedbackLevel = "success";
        toolsState.installFeedbackTitle = "安装成功";
        toolsState.installFeedbackDetail = `${itemKey} 已安装完成，可立即使用。`;
        toolsState.installProgress = INSTALL_PROGRESS_SUCCESS;
        toolsState.installMessage = "安装完成";

        // 先清除安装状态，确保重新渲染时显示正确的状态
        toolsState.installingKey = null;

        // 重新渲染网格，此时数据已经刷新
        this.renderToolsGrid();
        this.renderInstallState();

        showGlobalNotice("安装成功", `${itemKey} 已可使用`, "success", 2600);
      } else {
        toolsState.installState = "安装失败（返回码非 0）";
        toolsState.installFeedbackLevel = "error";
        toolsState.installFeedbackTitle = "安装失败（返回码非 0）";
        toolsState.installFeedbackDetail = result.stderr || "请查看安装日志获取详细信息。";
        toolsState.installProgress = INSTALL_PROGRESS_FAIL;
        toolsState.installMessage = "安装失败";
        showGlobalNotice("安装失败（返回码非 0）", toolsState.installFeedbackDetail, "error");
        this.renderInstallState();
      }
    } catch (error) {
      this.clearInstallProgressTimer();
      toolsState.appendLog(`安装调用异常：${String(error)}`);
      toolsState.installState = "安装异常";
      toolsState.installFeedbackLevel = "error";
      toolsState.installFeedbackTitle = "安装异常";
      toolsState.installFeedbackDetail = String(error);
      toolsState.installProgress = INSTALL_PROGRESS_FAIL;
      toolsState.installMessage = "安装异常";
      showGlobalNotice("安装异常", String(error), "error");
    } finally {
      this.clearInstallProgressTimer();
      toolsState.installingKey = null;
      this.renderToolsGrid();
      this.renderInstallState();
    }
  }

  /**
   * 卸载工具
   */
  async uninstallTool(itemKey: string): Promise<void> {
    this.clearInstallProgressTimer();
    toolsState.uninstallingKey = itemKey;
    toolsState.installState = `卸载中：${itemKey}`;
    toolsState.installFeedbackLevel = "running";
    toolsState.installFeedbackTitle = "正在卸载";
    toolsState.installFeedbackDetail = `已提交卸载任务：${itemKey}`;
    toolsState.installMessage = "执行卸载命令";
    toolsState.installProgress = INSTALL_PROGRESS_DISPATCH;
    toolsState.appendLog(`\n>>> 开始卸载 ${itemKey}`);
    this.renderToolsGrid();
    this.renderInstallState();
    this.startInstallProgressLoop();

    try {
      const response = await toolsService.uninstallTool(itemKey);

      toolsState.installProgress = INSTALL_PROGRESS_HANDLE_RESPONSE;
      toolsState.installMessage = "处理卸载结果";
      this.renderInstallState();

      if (!response.ok || !response.data) {
        this.clearInstallProgressTimer();
        toolsState.appendLog(`卸载失败：${response.error ?? "未知错误"}`);
        toolsState.installState = "卸载失败";
        toolsState.installFeedbackLevel = "error";
        toolsState.installFeedbackTitle = "卸载失败";
        toolsState.installFeedbackDetail = response.error ?? "卸载命令未返回有效数据";
        toolsState.installProgress = INSTALL_PROGRESS_FAIL;
        toolsState.installMessage = "卸载失败";
        showGlobalNotice("卸载失败", toolsState.installFeedbackDetail, "error");
        this.renderInstallState();
        return;
      }

      const result = response.data;
      toolsState.appendLog(`命令：${result.command}`);
      toolsState.appendLog(`返回码：${result.exitCode}`);
      if (result.stdout) {
        toolsState.appendLog(`stdout:\n${result.stdout}`);
      }
      if (result.stderr) {
        toolsState.appendLog(`stderr:\n${result.stderr}`);
      }

      if (result.exitCode === 0) {
        this.clearInstallProgressTimer();
        toolsState.installProgress = INSTALL_PROGRESS_SYNC;
        toolsState.installMessage = "同步最新状态";
        this.renderInstallState();

        // 刷新缓存以获取最新的工具状态
        await toolsService.refreshCache(true);

        toolsState.installState = "卸载完成";
        toolsState.installFeedbackLevel = "success";
        toolsState.installFeedbackTitle = "卸载成功";
        toolsState.installFeedbackDetail = `${itemKey} 已卸载完成。`;
        toolsState.installProgress = INSTALL_PROGRESS_SUCCESS;
        toolsState.installMessage = "卸载完成";

        // 先清除卸载状态，确保重新渲染时显示正确的状态
        toolsState.uninstallingKey = null;

        // 重新渲染网格，此时数据已经刷新
        this.renderToolsGrid();
        this.renderInstallState();

        showGlobalNotice("卸载成功", `${itemKey} 已卸载`, "success", 2600);
      } else {
        toolsState.installState = "卸载失败（返回码非 0）";
        toolsState.installFeedbackLevel = "error";
        toolsState.installFeedbackTitle = "卸载失败（返回码非 0）";
        toolsState.installFeedbackDetail = result.stderr || "请查看安装日志获取详细信息。";
        toolsState.installProgress = INSTALL_PROGRESS_FAIL;
        toolsState.installMessage = "卸载失败";
        showGlobalNotice("卸载失败（返回码非 0）", toolsState.installFeedbackDetail, "error");
        this.renderInstallState();
      }
    } catch (error) {
      this.clearInstallProgressTimer();
      toolsState.appendLog(`卸载调用异常：${String(error)}`);
      toolsState.installState = "卸载异常";
      toolsState.installFeedbackLevel = "error";
      toolsState.installFeedbackTitle = "卸载异常";
      toolsState.installFeedbackDetail = String(error);
      toolsState.installProgress = INSTALL_PROGRESS_FAIL;
      toolsState.installMessage = "卸载异常";
      showGlobalNotice("卸载异常", String(error), "error");
    } finally {
      this.clearInstallProgressTimer();
      toolsState.uninstallingKey = null;
      this.renderToolsGrid();
      this.renderInstallState();
    }
  }

  /**
   * 渲染安装状态
   */
  renderInstallState(): void {
    const stateEl = document.getElementById("install-status");
    const logEl = document.getElementById("install-log");

    if (stateEl) {
      stateEl.textContent = toolsState.installState || "空闲";
    }

    if (logEl) {
      logEl.textContent = toolsState.installLog;
      logEl.scrollTop = logEl.scrollHeight;
    }

    this.updateActiveToolProgressDom();
  }

  private updateActiveToolProgressDom(): void {
    const activeKey = toolsState.installingKey ?? toolsState.uninstallingKey;
    if (!activeKey) {
      return;
    }

    const blocks = document.querySelectorAll<HTMLElement>(".tool-install-progress[data-tool-progress]");
    if (blocks.length === 0) {
      return;
    }

    const progress = Math.max(4, toolsState.installProgress);
    const progressText = `${Math.round(toolsState.installProgress)}%`;
    const statusText = toolsState.installMessage || (toolsState.installingKey ? "安装中" : "卸载中");

    blocks.forEach((block) => {
      if (block.dataset.toolProgress !== activeKey) {
        return;
      }

      const statusEl = block.querySelector<HTMLElement>("[data-tool-progress-status]");
      const valueEl = block.querySelector<HTMLElement>("[data-tool-progress-value]");
      const textEl = block.querySelector<HTMLElement>("[data-tool-progress-text]");

      if (statusEl) {
        statusEl.textContent = statusText;
      }

      if (valueEl) {
        valueEl.style.width = `${progress}%`;
        valueEl.classList.toggle("is-install", toolsState.installingKey !== null);
        valueEl.classList.toggle("is-uninstall", toolsState.uninstallingKey !== null);
      }

      if (textEl) {
        textEl.textContent = progressText;
      }
    });
  }

  private startInstallProgressLoop(): void {
    this.clearInstallProgressTimer();

    const tick = () => {
      const hasTask = toolsState.installingKey !== null || toolsState.uninstallingKey !== null;
      if (!hasTask || toolsState.installFeedbackLevel !== "running") {
        toolsState.installProgressTimer = null;
        return;
      }

      const current = toolsState.installProgress;
      // 越接近上限越慢，但永远不会完全停止
      const remaining = 96 - current;
      const step = remaining > 20 ? 2 : remaining > 8 ? 0.8 : 0.2;
      toolsState.installProgress = Math.min(96, current + step);

      if (current >= 70) {
        toolsState.installMessage = "安装进行中，正在等待命令完成";
      } else if (current >= 46) {
        toolsState.installMessage = "写入安装输出";
      }
      this.renderInstallState();

      const interval = remaining > 20 ? 280 : remaining > 8 ? 500 : 1200;
      toolsState.installProgressTimer = window.setTimeout(tick, interval);
    };

    toolsState.installProgressTimer = window.setTimeout(tick, 280);
  }

  private clearInstallProgressTimer(): void {
    if (toolsState.installProgressTimer !== null) {
      window.clearTimeout(toolsState.installProgressTimer);
      toolsState.installProgressTimer = null;
    }
  }

  /**
   * 筛选工具列表
   */
  private filterTools(tools: ToolStatus[], filters: ToolFilterState): ToolStatus[] {
    const search = filters.search.trim().toLowerCase();

    return tools.filter((tool) => {
      const searchMatch =
        search.length === 0 ||
        tool.name.toLowerCase().includes(search) ||
        tool.command.toLowerCase().includes(search) ||
        tool.category.toLowerCase().includes(search) ||
        (tool.version ?? "").toLowerCase().includes(search);

      if (!searchMatch) {
        return false;
      }

      if (filters.status === "installed" && !tool.installed) {
        return false;
      }

      if (filters.status === "missing" && tool.installed) {
        return false;
      }

      if (filters.category !== "all" && tool.category !== filters.category) {
        return false;
      }

      return true;
    });
  }

  /**
   * 获取市场元数据
   */
  private getMarketMeta(tool: ToolStatus): MarketMeta {
    const installKey = tool.installKey ?? "";
    const meta = marketMetaMap[installKey];
    if (meta) {
      return meta;
    }

    return {
      title: tool.name,
      description: "本地工具检测项，可用于环境能力验证。",
      tags: ["#local", `#${tool.category.toLowerCase()}`],
      hot: "--",
      downloads: "--",
      type: tool.category,
    };
  }

  private fetchAndUpdateDownloads(): void {
    void toolsService.fetchNpmDownloads().then(() => {
      if (appState.currentPage === "tools") {
        this.renderToolsGrid();
      }
    });
  }

  /**
   * 调度自动刷新
   */
  private scheduleAutoRefresh(renderEpoch?: number): void {
    if (appState.currentPage !== "tools" || toolsState.refreshing || !toolsService.isCacheStale()) {
      return;
    }

    if (toolsState.autoRefreshTimer !== null) {
      window.clearTimeout(toolsState.autoRefreshTimer);
    }

    const epochWhenQueued = renderEpoch ?? appState.pageRenderEpoch;
    toolsState.autoRefreshTimer = window.setTimeout(() => {
      toolsState.autoRefreshTimer = null;

      if (appState.currentPage !== "tools" || toolsState.refreshing || appState.isRenderStale(epochWhenQueued, "tools")) {
        return;
      }

      const contentEl = document.getElementById("content");
      if (!contentEl) {
        return;
      }

      void this.runRefreshWithSoftTimeout(contentEl, true, epochWhenQueued).then((result) => {
        if (appState.currentPage !== "tools" || appState.isRenderStale(epochWhenQueued, "tools")) {
          return;
        }

        if (!result.ok && toolsState.dataCache.length === 0) {
          this.renderDetectErrorState(contentEl, result.error ?? "环境探测失败");
          return;
        }

        this.renderWithData(contentEl);
      });
    }, 260);
  }
}

/** 全局 Tools 页面实例 */
export const toolsPage = new ToolsPage();
