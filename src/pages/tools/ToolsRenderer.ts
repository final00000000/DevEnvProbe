/**
 * Tools 页面渲染器 - 负责 HTML 模板生成
 */

import { toolsState } from "../../state";
import { toolsService, installPathPolicy } from "../../services";
import { marketMetaMap } from "../../config/app-config";
import type { ToolStatus, MarketMeta, ToolFilterState } from "../../types";
import { escapeHtml } from "../../utils/formatters";

export class ToolsRenderer {
  /**
   * 渲染主页面结构
   */
  renderPage(): string {
    const installedCount = toolsState.dataCache.filter((item) => item.installed).length;
    const refreshStatus = this.buildRefreshStatusHtml();
    const changedText =
      toolsState.diffInstalled === 0 && toolsState.diffMissing === 0
        ? "无变化"
        : `+${toolsState.diffInstalled} / -${toolsState.diffMissing}`;
    const defaultInstallPath = installPathPolicy.getDefaultPath();
    const installPathPlaceholder = defaultInstallPath
      ? `安装路径（留空回退到设置默认：${defaultInstallPath}）`
      : "安装路径（可选，如 D:/DevTools）";
    const installPathHint = defaultInstallPath
      ? `优先级：当前输入 > 设置默认（${defaultInstallPath}）> 系统默认`
      : "优先级：当前输入 > 设置默认 > 系统默认";

    return `
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

        <div class="grid grid-cols-3 gap-3 mb-1">
          <input id="install-path" class="input col-span-2" placeholder="${escapeHtml(installPathPlaceholder)}" value="${escapeHtml(
            toolsState.installPath
          )}" />
          <button id="pick-install-path" class="btn btn-secondary" aria-label="选择安装路径目录">选择目录</button>
        </div>
        <p class="text-xs text-text-secondary mb-4">${escapeHtml(installPathHint)}</p>

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
  }

  /**
   * 渲染探测错误状态
   */
  renderErrorState(detail: string): string {
    return `
      <div class="card animate-fade-in tools-detect-error">
        <h3 class="text-lg font-semibold text-error mb-2">环境探测失败</h3>
        <p class="text-sm text-text-secondary mb-4">${escapeHtml(detail)}</p>
        <button id="tools-retry-btn" type="button" class="btn btn-primary">重新探测</button>
      </div>
    `;
  }

  /**
   * 构建刷新状态标签
   */
  buildRefreshStatusHtml(): string {
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

  /**
   * 构建工具卡片 HTML
   */
  buildToolCard(tool: ToolStatus): string {
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

  /**
   * 构建占位符卡片
   */
  buildPlaceholderCards(): string {
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
   * 筛选工具列表
   */
  filterTools(tools: ToolStatus[], filters: ToolFilterState): ToolStatus[] {
    const search = filters.search.trim().toLowerCase();

    return tools.filter((tool) => {
      const searchMatch =
        search.length === 0 ||
        tool.name.toLowerCase().includes(search) ||
        tool.command.toLowerCase().includes(search) ||
        tool.category.toLowerCase().includes(search) ||
        (tool.version ?? "").toLowerCase().includes(search);

      if (!searchMatch) return false;
      if (filters.status === "installed" && !tool.installed) return false;
      if (filters.status === "missing" && tool.installed) return false;
      if (filters.category !== "all" && tool.category !== filters.category) return false;

      return true;
    });
  }

  /**
   * 获取市场元数据
   */
  getMarketMeta(tool: ToolStatus): MarketMeta {
    const installKey = tool.installKey ?? "";
    const meta = marketMetaMap[installKey];
    if (meta) return meta;

    return {
      title: tool.name,
      description: "本地工具检测项，可用于环境能力验证。",
      tags: ["#local", `#${tool.category.toLowerCase()}`],
      hot: "--",
      downloads: "--",
      type: tool.category,
    };
  }
}

export const toolsRenderer = new ToolsRenderer();
