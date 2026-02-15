/**
 * Tools 页面协调器 - 负责业务流程控制
 */

import { toolsState, appState } from "../../state";
import { toolsService, installPathPolicy } from "../../services";
import { showLoading, showGlobalNotice } from "../../modules/shell-ui";
import { toolsRenderer } from "./ToolsRenderer";
import { toolsController } from "./ToolsController";

const PROGRESS = {
  START: 8,
  PREPARE: 18,
  DISPATCH: 32,
  HANDLE_RESPONSE: 62,
  SYNC: 86,
  DONE: 100,
};

type ToolActionType = "install" | "uninstall";

export class ToolsCoordinator {
  constructor() {
    toolsController.setCoordinator(this);
  }

  /**
   * 带软超时的刷新
   */
  async runRefreshWithSoftTimeout(
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
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    }
  }

  /**
   * 渲染页面入口
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
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "tools")) return;

    // 错误分级处理
    if (!refreshResult.ok) {
      if (refreshResult.errorType === 'transient') {
        // 瞬时错误：显示缓存数据 + 错误提示
        this.renderWithData(container);
        showGlobalNotice("环境探测失败", `${refreshResult.error}，当前展示缓存结果`, "error");
      } else if (refreshResult.errorType === 'fatal') {
        // 致命错误：显示错误页面
        this.renderErrorState(container, refreshResult.error ?? "无法获取工具状态");
      } else {
        // 兜底处理
        if (toolsState.dataCache.length === 0) {
          this.renderErrorState(container, refreshResult.error ?? "无法获取工具状态");
        } else {
          this.renderWithData(container);
          showGlobalNotice("环境探测失败", `${refreshResult.error}，当前展示缓存结果`, "error");
        }
      }
      return;
    }

    this.renderWithData(container);
    this.fetchAndUpdateDownloads();
  }

  /**
   * 使用数据渲染页面
   */
  renderWithData(container: HTMLElement): void {
    container.innerHTML = toolsRenderer.renderPage();
    this.renderGrid();
    toolsController.bindPageActions();
  }

  /**
   * 渲染错误状态
   */
  renderErrorState(container: HTMLElement, detail: string): void {
    container.innerHTML = toolsRenderer.renderErrorState(detail);

    const retryBtn = container.querySelector<HTMLButtonElement>("#tools-retry-btn");
    if (!retryBtn) return;

    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "探测中...";

      try {
        const result = await this.runRefreshWithSoftTimeout(container, true);
        if (!result.ok && toolsState.dataCache.length === 0) {
          this.renderErrorState(container, result.error ?? "环境探测失败，请稍后重试");
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
  renderGrid(): void {
    const grid = document.getElementById("tools-grid");
    if (!grid) return;

    const filtered = toolsRenderer.filterTools(toolsState.dataCache, toolsState.filters);
    const renderToken = ++toolsState.gridRenderToken;

    if (filtered.length === 0) {
      if (toolsState.refreshing && toolsState.scanSoftTimeoutActive) {
        grid.innerHTML = toolsRenderer.buildPlaceholderCards();
        return;
      }
      grid.innerHTML = '<div class="card col-span-3">当前筛选条件无结果</div>';
      return;
    }

    grid.innerHTML = "";

    const renderBatch = (startIndex: number): void => {
      if (renderToken !== toolsState.gridRenderToken || appState.currentPage !== "tools") return;

      const endIndex = Math.min(startIndex + 12, filtered.length);
      const batchHtml = filtered
        .slice(startIndex, endIndex)
        .map((tool) => toolsRenderer.buildToolCard(tool))
        .join("");

      if (batchHtml) grid.insertAdjacentHTML("beforeend", batchHtml);

      if (endIndex < filtered.length) {
        window.requestAnimationFrame(() => renderBatch(endIndex));
        return;
      }

      toolsController.bindGridActions();
    };

    renderBatch(0);
  }

  /**
   * 处理刷新按钮点击
   */
  async handleRefresh(contentEl: HTMLElement): Promise<void> {
    // 立即显示加载状态，确保 UI 及时响应
    showLoading(contentEl, "正在刷新环境探测...", {
      loadingId: "tools-refresh-loading",
      hint: "正在重新扫描本机开发工具..."
    });

    const result = await this.runRefreshWithSoftTimeout(contentEl, true);
    if (appState.currentPage !== "tools") return;

    // 错误分级处理
    if (!result.ok) {
      if (result.errorType === 'transient') {
        // 瞬时错误：显示缓存数据 + 错误提示
        this.renderWithData(contentEl);
        showGlobalNotice("环境探测失败", `${result.error}，当前展示缓存结果`, "error");
      } else if (result.errorType === 'fatal') {
        // 致命错误：显示错误页面
        this.renderErrorState(contentEl, result.error ?? "环境探测失败");
        showGlobalNotice("环境探测失败", result.error ?? "请稍后重试", "error");
      } else {
        // 兜底处理
        if (toolsState.dataCache.length === 0) {
          this.renderErrorState(contentEl, result.error ?? "环境探测失败");
          showGlobalNotice("环境探测失败", result.error ?? "请稍后重试", "error");
        } else {
          this.renderWithData(contentEl);
          showGlobalNotice("环境探测失败", `${result.error}，当前展示缓存结果`, "error");
        }
      }
      return;
    }

    this.renderWithData(contentEl);
    if (result.retried) {
      showGlobalNotice("环境探测已恢复", "请求已自动重试并成功同步", "success", 2200);
    } else {
      showGlobalNotice("刷新完成", "环境探测数据已更新", "success", 1500);
    }
  }

  /**
   * 执行工具操作（安装/卸载）- DRY 合并
   */
  async executeToolAction(itemKey: string, action: ToolActionType): Promise<void> {
    const isInstall = action === "install";
    const actionLabel = isInstall ? "安装" : "卸载";

    // 安装前检查 winget 前置条件
    if (isInstall) {
      const wingetCheck = await toolsService.checkWingetPrerequisite();

      if (wingetCheck.ok && wingetCheck.data && !wingetCheck.data.available) {
        const shouldInstall = window.confirm(
          "检测到系统缺少 App Installer (winget)，这是安装工具的必要组件。\n\n是否自动安装 App Installer？\n\n注意：安装过程可能需要几分钟，且需要管理员权限。"
        );

        if (!shouldInstall) {
          showGlobalNotice(
            "安装已取消",
            "需要先安装 App Installer 才能继续安装工具",
            "info",
            3000
          );
          return;
        }

        // 设置进度跟踪状态
        this.clearProgressTimer();
        toolsState.prerequisiteInstalling = true;
        toolsState.installState = "安装前置条件中：App Installer";
        toolsState.installFeedbackLevel = "running";
        toolsState.installFeedbackTitle = "正在安装 App Installer";
        toolsState.installFeedbackDetail = "正在从 GitHub 下载并安装，请稍候...";
        toolsState.installMessage = "正在准备下载 App Installer...";
        toolsState.installProgress = PROGRESS.START;
        toolsState.appendLog("\n>>> 开始安装 App Installer");

        this.renderGrid();
        this.renderInstallState();
        this.startProgressLoop();

        // 安装 App Installer
        const installResult = await toolsService.installAppInstaller();

        // 清理进度状态
        this.clearProgressTimer();

        if (!installResult.ok || !installResult.data || installResult.data.exitCode !== 0) {
          // 优先显示 stdout（PowerShell 的 Write-Output），然后是 stderr，最后是默认错误
          const errorMsg = installResult.data?.stdout || installResult.data?.stderr || installResult.error || "安装失败";

          toolsState.installProgress = PROGRESS.DONE;
          toolsState.installMessage = "安装失败";
          toolsState.installFeedbackLevel = "error";
          toolsState.installFeedbackTitle = "App Installer 安装失败";
          toolsState.installFeedbackDetail = `${errorMsg}\n\n请手动从 Microsoft Store 安装 App Installer 后重试。`;
          toolsState.appendLog(`安装失败：${errorMsg}`);
          toolsState.prerequisiteInstalling = false;

          this.renderInstallState();
          showGlobalNotice(
            "App Installer 安装失败",
            `${errorMsg}\n\n请手动从 Microsoft Store 安装 App Installer 后重试。`,
            "error",
            5000
          );
          return;
        }

        // 安装成功
        toolsState.installProgress = PROGRESS.DONE;
        toolsState.installMessage = "安装完成";
        toolsState.installFeedbackLevel = "success";
        toolsState.installFeedbackTitle = "App Installer 安装成功";
        toolsState.installFeedbackDetail = "现在可以继续安装工具了";
        toolsState.appendLog("App Installer 安装成功");
        toolsState.prerequisiteInstalling = false;

        this.renderInstallState();
        showGlobalNotice("App Installer 安装成功", "现在可以继续安装工具了", "success", 2000);
      }
    }

    this.clearProgressTimer();

    if (isInstall) {
      toolsState.installingKey = itemKey;
    } else {
      toolsState.uninstallingKey = itemKey;
    }

    toolsState.installState = `${actionLabel}中：${itemKey}`;
    toolsState.installFeedbackLevel = "running";
    toolsState.installFeedbackTitle = `正在${actionLabel}`;
    toolsState.installFeedbackDetail = `已提交${actionLabel}任务：${itemKey}`;
    toolsState.installMessage = isInstall ? "准备安装命令" : "执行卸载命令";
    toolsState.installProgress = isInstall ? PROGRESS.START : PROGRESS.DISPATCH;
    toolsState.appendLog(`\n>>> 开始${actionLabel} ${itemKey}`);

    this.renderGrid();
    this.renderInstallState();
    this.startProgressLoop();

    if (isInstall) {
      toolsState.installProgress = PROGRESS.PREPARE;
      toolsState.installMessage = "解析安装参数";
      this.renderInstallState();
    }

    try {
      toolsState.installProgress = PROGRESS.DISPATCH;
      toolsState.installMessage = `执行${actionLabel}命令`;
      this.renderInstallState();
      const resolvedInstallPath = isInstall
        ? installPathPolicy.resolveInstallPath(toolsState.installPath)
        : null;

      if (isInstall) {
        toolsState.appendLog(`安装路径：${resolvedInstallPath ?? "系统默认路径"}`);
      }

      const response = isInstall
        ? await toolsService.installTool(itemKey, resolvedInstallPath)
        : await toolsService.uninstallTool(itemKey);

      toolsState.installProgress = PROGRESS.HANDLE_RESPONSE;
      toolsState.installMessage = `处理${actionLabel}结果`;
      this.renderInstallState();

      if (!response.ok || !response.data) {
        this.handleActionError(itemKey, actionLabel, response.error ?? "未知错误");
        return;
      }

      const result = response.data;
      toolsState.appendLog(`命令：${result.command}`);
      toolsState.appendLog(`返回码：${result.exitCode}`);
      if (result.stdout) toolsState.appendLog(`stdout:\n${result.stdout}`);
      if (result.stderr) toolsState.appendLog(`stderr:\n${result.stderr}`);

      if (result.exitCode === 0) {
        await this.handleActionSuccess(itemKey, actionLabel, isInstall);
      } else {
        this.handleActionFailure(actionLabel, result.stderr);
      }
    } catch (error) {
      this.handleActionException(actionLabel, String(error));
    } finally {
      this.clearProgressTimer();
      toolsState.installingKey = null;
      toolsState.uninstallingKey = null;
      this.renderGrid();
      this.renderInstallState();
    }
  }

  private handleActionError(_itemKey: string, actionLabel: string, error: string): void {
    this.clearProgressTimer();
    toolsState.appendLog(`${actionLabel}失败：${error}`);
    toolsState.installState = `${actionLabel}失败`;
    toolsState.installFeedbackLevel = "error";
    toolsState.installFeedbackTitle = `${actionLabel}失败`;
    toolsState.installFeedbackDetail = error;
    toolsState.installProgress = PROGRESS.DONE;
    toolsState.installMessage = `${actionLabel}失败`;
    showGlobalNotice(`${actionLabel}失败`, error, "error");
    this.renderInstallState();
  }

  private async handleActionSuccess(itemKey: string, actionLabel: string, isInstall: boolean): Promise<void> {
    this.clearProgressTimer();
    toolsState.installProgress = PROGRESS.SYNC;
    toolsState.installMessage = "同步最新状态";
    this.renderInstallState();

    await toolsService.refreshCache(true);

    toolsState.installState = `${actionLabel}完成`;
    toolsState.installFeedbackLevel = "success";
    toolsState.installFeedbackTitle = `${actionLabel}成功`;
    toolsState.installFeedbackDetail = `${itemKey} 已${actionLabel}完成。`;
    toolsState.installProgress = PROGRESS.DONE;
    toolsState.installMessage = `${actionLabel}完成`;

    if (isInstall) {
      toolsState.installingKey = null;
    } else {
      toolsState.uninstallingKey = null;
    }

    this.renderGrid();
    this.renderInstallState();
    showGlobalNotice(`${actionLabel}成功`, `${itemKey} 已${isInstall ? "可使用" : "卸载"}`, "success", 2600);
  }

  private handleActionFailure(actionLabel: string, stderr: string): void {
    toolsState.installState = `${actionLabel}失败（返回码非 0）`;
    toolsState.installFeedbackLevel = "error";
    toolsState.installFeedbackTitle = `${actionLabel}失败（返回码非 0）`;
    toolsState.installFeedbackDetail = stderr || "请查看安装日志获取详细信息。";
    toolsState.installProgress = PROGRESS.DONE;
    toolsState.installMessage = `${actionLabel}失败`;
    showGlobalNotice(`${actionLabel}失败（返回码非 0）`, toolsState.installFeedbackDetail, "error");
    this.renderInstallState();
  }

  private handleActionException(actionLabel: string, error: string): void {
    this.clearProgressTimer();
    toolsState.appendLog(`${actionLabel}调用异常：${error}`);
    toolsState.installState = `${actionLabel}异常`;
    toolsState.installFeedbackLevel = "error";
    toolsState.installFeedbackTitle = `${actionLabel}异常`;
    toolsState.installFeedbackDetail = error;
    toolsState.installProgress = PROGRESS.DONE;
    toolsState.installMessage = `${actionLabel}异常`;
    showGlobalNotice(`${actionLabel}异常`, error, "error");
  }

  /**
   * 渲染安装状态
   */
  renderInstallState(): void {
    const stateEl = document.getElementById("install-status");
    const logEl = document.getElementById("install-log");

    if (stateEl) stateEl.textContent = toolsState.installState || "空闲";
    if (logEl) {
      logEl.textContent = toolsState.installLog;
      logEl.scrollTop = logEl.scrollHeight;
    }

    this.updateActiveProgressDom();
  }

  private updateActiveProgressDom(): void {
    const activeKey = toolsState.installingKey ?? toolsState.uninstallingKey;
    if (!activeKey) return;

    const blocks = document.querySelectorAll<HTMLElement>(".tool-install-progress[data-tool-progress]");
    if (blocks.length === 0) return;

    const progress = Math.max(4, toolsState.installProgress);
    const progressText = `${Math.round(toolsState.installProgress)}%`;
    const statusText = toolsState.installMessage || (toolsState.installingKey ? "安装中" : "卸载中");

    blocks.forEach((block) => {
      if (block.dataset.toolProgress !== activeKey) return;

      const statusEl = block.querySelector<HTMLElement>("[data-tool-progress-status]");
      const valueEl = block.querySelector<HTMLElement>("[data-tool-progress-value]");
      const textEl = block.querySelector<HTMLElement>("[data-tool-progress-text]");

      if (statusEl) statusEl.textContent = statusText;
      if (valueEl) {
        valueEl.style.width = `${progress}%`;
        valueEl.classList.toggle("is-install", toolsState.installingKey !== null);
        valueEl.classList.toggle("is-uninstall", toolsState.uninstallingKey !== null);
      }
      if (textEl) textEl.textContent = progressText;
    });
  }

  private startProgressLoop(): void {
    this.clearProgressTimer();

    const tick = () => {
      const hasTask = toolsState.installingKey !== null || toolsState.uninstallingKey !== null;
      if (!hasTask || toolsState.installFeedbackLevel !== "running") {
        toolsState.installProgressTimer = null;
        return;
      }

      const current = toolsState.installProgress;
      const remaining = 96 - current;
      const step = remaining > 20 ? 2 : remaining > 8 ? 0.8 : 0.2;
      toolsState.installProgress = Math.min(96, current + step);

      if (current >= 70) {
        toolsState.installMessage = "操作进行中，正在等待命令完成";
      } else if (current >= 46) {
        toolsState.installMessage = "写入输出";
      }
      this.renderInstallState();

      const interval = remaining > 20 ? 280 : remaining > 8 ? 500 : 1200;
      toolsState.installProgressTimer = window.setTimeout(tick, interval);
    };

    toolsState.installProgressTimer = window.setTimeout(tick, 280);
  }

  private clearProgressTimer(): void {
    if (toolsState.installProgressTimer !== null) {
      window.clearTimeout(toolsState.installProgressTimer);
      toolsState.installProgressTimer = null;
    }
  }

  private fetchAndUpdateDownloads(): void {
    void toolsService.fetchNpmDownloads().then(() => {
      if (appState.currentPage === "tools") this.renderGrid();
    });
  }

  private scheduleAutoRefresh(renderEpoch?: number): void {
    if (appState.currentPage !== "tools" || toolsState.refreshing || !toolsService.isCacheStale()) return;

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
      if (!contentEl) return;

      void this.runRefreshWithSoftTimeout(contentEl, true, epochWhenQueued).then((result) => {
        if (appState.currentPage !== "tools" || appState.isRenderStale(epochWhenQueued, "tools")) return;

        if (!result.ok) {
          if (result.errorType === "fatal" && toolsState.dataCache.length === 0) {
            this.renderErrorState(contentEl, result.error ?? "环境探测失败");
            return;
          }

          this.renderWithData(contentEl);
          if (result.errorType === "transient") {
            showGlobalNotice("环境探测失败", `${result.error}，当前展示缓存结果`, "error");
          } else if (result.errorType === "fatal") {
            showGlobalNotice("环境探测失败", result.error ?? "请稍后重试", "error");
          }
          return;
        }

        this.renderWithData(contentEl);
        if (result.retried) {
          showGlobalNotice("环境探测已恢复", "请求已自动重试并成功同步", "success", 2200);
        }
      });
    }, 260);
  }
}

export const toolsCoordinator = new ToolsCoordinator();
