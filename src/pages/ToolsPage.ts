/**
 * Tools 页面渲染模块
 */

import { toolsState, appState } from "../state";
import { toolsService } from "../services";
import { getErrorBlock, showLoading } from "../modules/shell-ui";
import { marketMetaMap } from "../config/app-config";
import type { ToolStatus, MarketMeta, ToolFilterState } from "../types";
import { escapeHtml } from "../utils/formatters";
import { TOOL_SEARCH_DEBOUNCE_MS } from "../constants/config";

/**
 * Tools 页面渲染类
 */
export class ToolsPage {
  /**
   * 渲染 Tools 页面
   */
  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    const hadSnapshot = toolsState.dataCache.length > 0;

    if (hadSnapshot) {
      this.renderWithData(container);
      this.scheduleAutoRefresh(renderEpoch);
      return;
    }

    showLoading(container, "正在探测本机开发环境...");
    const loaded = await toolsService.refreshCache(true);
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "tools")) {
      return;
    }

    if (!loaded && toolsState.dataCache.length === 0) {
      container.innerHTML = getErrorBlock("环境探测失败", "无法获取工具状态，请点击\"重新探测\"重试。");
      return;
    }

    this.renderWithData(container);
  }

  /**
   * 使用数据渲染页面
   */
  renderWithData(container: HTMLElement): void {
    const installedCount = toolsState.dataCache.filter((item) => item.installed).length;
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
          <div class="text-xs text-text-secondary">上次探测：${escapeHtml(
            toolsService.formatRelativeTime(toolsState.lastScanAt)
          )}</div>
          <button id="tools-refresh-btn" class="btn btn-secondary" ${toolsState.refreshing ? "disabled" : ""}>${
            toolsState.refreshing ? "探测中..." : "重新探测"
          }</button>
        </div>

        <div class="grid grid-cols-4 gap-3 mb-4">
          <input id="tool-search" class="input col-span-2" placeholder="搜索技术栈、镜像、工具..." value="${escapeHtml(
            toolsState.filters.search
          )}" />
          <select id="tool-status-filter" class="select">
            <option value="all" ${toolsState.filters.status === "all" ? "selected" : ""}>全部状态</option>
            <option value="installed" ${toolsState.filters.status === "installed" ? "selected" : ""}>仅已安装</option>
            <option value="missing" ${toolsState.filters.status === "missing" ? "selected" : ""}>仅未安装</option>
          </select>
          <select id="tool-category-filter" class="select">
            <option value="all">全部分类</option>
            ${toolsState.categories
              .map((category) => {
                const selected = toolsState.filters.category === category ? "selected" : "";
                return `<option value="${escapeHtml(category)}" ${selected}>${escapeHtml(category)}</option>`;
              })
              .join("")}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-4">
          <input id="install-path" class="input col-span-2" placeholder="安装路径（可选，如 D:/DevTools）" value="${escapeHtml(
            toolsState.installPath
          )}" />
          <button id="pick-install-path" class="btn btn-secondary">选择目录</button>
        </div>

        <div id="tools-grid" class="grid grid-cols-3 gap-4"></div>
      </div>

      <div class="card animate-fade-in">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-semibold text-text-primary">安装日志</h3>
          <span id="install-status" class="text-xs text-text-secondary">${escapeHtml(toolsState.installState || "空闲")}</span>
        </div>
        <div id="install-log" class="install-log">${escapeHtml(toolsState.installLog)}</div>
      </div>
    </div>
  `;

    this.renderToolsGrid();
    this.bindToolPageActions();
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
    const installing = toolsState.installingKey !== null && toolsState.installingKey === installKey;
    const buttonText = tool.installed ? "重装" : "安装";

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
        ${tool.details ? `<div class="text-text-muted">详情：${escapeHtml(tool.details)}</div>` : ""}
      </div>

      <div class="flex items-center justify-between text-xs text-text-muted mb-3">
        <span>★ ${escapeHtml(meta.hot)}</span>
        <span>↓ ${escapeHtml(meta.downloads)}</span>
      </div>

      <button class="btn btn-install w-full" data-install-key="${escapeHtml(installKey)}" ${
        !canInstall || installing ? "disabled" : ""
      }>
        ${installing ? "安装中..." : buttonText}
      </button>
    </div>
  `;
  }

  /**
   * 绑定工具页面交互事件
   */
  bindToolPageActions(): void {
    const searchInput = document.getElementById("tool-search") as HTMLInputElement | null;
    const statusFilter = document.getElementById("tool-status-filter") as HTMLSelectElement | null;
    const categoryFilter = document.getElementById("tool-category-filter") as HTMLSelectElement | null;
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

    statusFilter?.addEventListener("change", () => {
      toolsState.filters.status = statusFilter.value as ToolFilterState["status"];
      this.renderToolsGrid();
    });

    categoryFilter?.addEventListener("change", () => {
      toolsState.filters.category = categoryFilter.value;
      this.renderToolsGrid();
    });

    pathInput?.addEventListener("input", () => {
      toolsState.installPath = pathInput.value;
    });

    refreshBtn?.addEventListener("click", async () => {
      if (toolsState.refreshing) {
        return;
      }

      const ok = await toolsService.refreshCache(true);
      if (!ok || appState.currentPage !== "tools") {
        return;
      }

      const contentEl = document.getElementById("content");
      if (contentEl) {
        await this.render(contentEl);
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
   * 绑定安装按钮事件
   */
  bindInstallButtons(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>("[data-install-key]");
    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        const key = button.dataset.installKey;
        if (!key) {
          return;
        }
        await this.installTool(key);
      });
    });
  }

  /**
   * 安装工具
   */
  async installTool(itemKey: string): Promise<void> {
    toolsState.installingKey = itemKey;
    toolsState.installState = `安装中：${itemKey}`;
    toolsState.appendLog(`\n>>> 开始安装 ${itemKey}`);
    this.renderToolsGrid();
    this.renderInstallState();

    try {
      const response = await toolsService.installTool(itemKey, toolsState.installPath);

      if (!response.ok || !response.data) {
        toolsState.appendLog(`安装失败：${response.error ?? "未知错误"}`);
        toolsState.installState = "安装失败";
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
        toolsState.installState = "安装完成";
      } else {
        toolsState.installState = "安装失败（返回码非 0）";
      }

      await toolsService.refreshCache(true);
    } catch (error) {
      toolsState.appendLog(`安装调用异常：${String(error)}`);
      toolsState.installState = "安装异常";
    } finally {
      toolsState.installingKey = null;
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

      void toolsService.refreshCache(true).then((ok) => {
        if (!ok || appState.currentPage !== "tools" || appState.isRenderStale(epochWhenQueued, "tools")) {
          return;
        }

        const contentEl = document.getElementById("content");
        if (contentEl) {
          this.renderWithData(contentEl);
        }
      });
    }, 260);
  }
}

/** 全局 Tools 页面实例 */
export const toolsPage = new ToolsPage();
