/**
 * DevEnvProbe 应用入口文件
 *
 * 职责：
 * 1. 初始化应用核心模块（导航、生命周期、UI）
 * 2. 组装各页面渲染器
 * 3. 启动应用主循环
 *
 * 原始文件：2044 行 → 重构后：~80 行（减少 96%）
 */

import { appState, systemState, toolsState, dockerState } from "./state";
import { systemService } from "./services";
import { systemPage, toolsPage, dockerPage } from "./pages";
import { MemoryMonitor } from "./utils/memory-monitor";
import {
  initNavigation,
  switchPage,
  initLifecycleEvents,
  scheduleResumeRefresh,
  restoreCachedPageRoot,
} from "./core";
import {
  ensureShellRuntimeStyles,
  initThemeToggle,
  initRefreshButton,
  loadThemePreference,
  getSettingsContent,
  bindSettingsActions,
  getErrorBlock,
  showLoading,
} from "./modules/shell-ui";
import {
  SYSTEM_INITIAL_LOADING_RETRY_MAX,
  SYSTEM_INITIAL_LOADING_WATCHDOG_MS,
} from "./constants/config";

let systemLoadingWatchdogTimer: number | null = null;
let systemLoadingRetryBudget = SYSTEM_INITIAL_LOADING_RETRY_MAX;

function clearSystemLoadingWatchdog(resetBudget: boolean): void {
  if (systemLoadingWatchdogTimer !== null) {
    window.clearTimeout(systemLoadingWatchdogTimer);
    systemLoadingWatchdogTimer = null;
  }

  if (resetBudget) {
    systemLoadingRetryBudget = SYSTEM_INITIAL_LOADING_RETRY_MAX;
  }
}

function armSystemLoadingWatchdog(renderEpoch: number): void {
  clearSystemLoadingWatchdog(false);

  systemLoadingWatchdogTimer = window.setTimeout(() => {
    systemLoadingWatchdogTimer = null;

    if (appState.currentPage !== "system" || appState.pageRenderEpoch !== renderEpoch) {
      return;
    }

    const container = document.getElementById("content");
    if (!container) {
      return;
    }

    const hasDashboard = container.querySelector("#system-dashboard") !== null;
    if (hasDashboard || systemState.snapshotCache !== null) {
      clearSystemLoadingWatchdog(true);
      return;
    }

    if (systemLoadingRetryBudget <= 0) {
      showLoading(container, "系统信息采集中，请稍候...", {
        loadingId: "system-loading-panel",
        hint: "采集耗时较长时将自动继续重试，无需手动刷新。",
      });
      return;
    }

    systemLoadingRetryBudget -= 1;
    void renderCurrentPage({ allowDomReuse: false });
  }, SYSTEM_INITIAL_LOADING_WATCHDOG_MS);
}

// ==================== 应用初始化 ====================

window.addEventListener("DOMContentLoaded", () => {
  if (import.meta.env.DEV) {
    const globalMemoryTimer = MemoryMonitor.getInstance().startMonitoring(30_000);
    window.addEventListener("beforeunload", () => {
      MemoryMonitor.getInstance().stopMonitoring(globalMemoryTimer);
    }, { once: true });
  }

  ensureShellRuntimeStyles();
  initNavigation((page) =>
    switchPage(page, renderCurrentPage, syncSystemAutoRefresh, (previousPage, nextPage) => {
      if (previousPage === "tools" && nextPage !== "tools") {
        toolsState.gridRenderToken += 1;
      }

      if (previousPage === "docker" && nextPage !== "docker") {
        dockerPage.cleanup();
      }
    })
  );
  initThemeToggle();
  initRefreshButton(async () => {
    await renderCurrentPage({ allowDomReuse: false });
  });
  loadThemePreference();
  initLifecycleEvents(() => scheduleResumeRefresh(onResumeRefresh));

  void renderCurrentPage();
  window.setTimeout(() => {
    syncSystemAutoRefresh();
  }, 600);
});

// ==================== 页面渲染 ====================

interface RenderPageOptions {
  allowDomReuse?: boolean;
}

async function renderCurrentPage(options: RenderPageOptions = {}): Promise<void> {
  const contentEl = document.getElementById("content");
  if (!contentEl) {
    return;
  }

  const renderEpoch = appState.incrementRenderEpoch();
  const targetPage = appState.currentPage;

  if (targetPage !== "system") {
    clearSystemLoadingWatchdog(true);
  }

  // DOM 复用优化
  if (options.allowDomReuse && (targetPage === "system" || targetPage === "tools")) {
    if (restoreCachedPageRoot(contentEl, targetPage)) {
      if (targetPage === "system") {
        systemPage.renderAnchoredUptimeIfVisible();
        clearSystemLoadingWatchdog(true);
      }
      return;
    }
  }

  // 检查是否有缓存数据
  const hasCache =
    (targetPage === "system" && systemState.snapshotCache !== null) ||
    (targetPage === "tools" && toolsState.dataCache.length > 0) ||
    (targetPage === "docker" && dockerState.bootstrapped);

  if (!hasCache) {
    const loadingText = targetPage === "system"
      ? "正在采集系统信息（首次需要2秒建立基准）..."
      : "正在加载数据...";
    const loadingHint = targetPage === "system"
      ? "首次采样可能需要几秒，期间不会阻塞界面。"
      : "请稍候，正在准备页面数据。";
    showLoading(contentEl, loadingText, {
      loadingId: `${targetPage}-loading-panel`,
      hint: loadingHint,
    });

    if (targetPage === "system") {
      armSystemLoadingWatchdog(renderEpoch);
    }
  }

  // 路由到对应页面
  if (targetPage === "system") {
    try {
      await systemPage.render(contentEl, renderEpoch);
    } catch (error) {
      if (!appState.isRenderStale(renderEpoch, "system")) {
        contentEl.innerHTML = getErrorBlock("系统首页渲染失败", String(error));
      }
      return;
    }

    if (!contentEl.querySelector("#system-dashboard") && appState.currentPage === "system") {
      const detail = systemState.snapshotCache === null
        ? "首次采集耗时较长，正在后台持续重试..."
        : "当前使用缓存数据，后台正在继续同步最新指标。";
      showLoading(contentEl, "系统信息采集中，请稍候...", {
        loadingId: "system-loading-panel",
        hint: detail,
      });
    }

    if (contentEl.querySelector("#system-dashboard") || systemState.snapshotCache !== null) {
      clearSystemLoadingWatchdog(true);
    }

    return;
  }

  if (targetPage === "tools") {
    await toolsPage.render(contentEl, renderEpoch);
    return;
  }

  if (targetPage === "docker") {
    await dockerPage.render(contentEl, renderEpoch);
    return;
  }

  // Settings 页面
  if (appState.isRenderStale(renderEpoch, targetPage)) {
    return;
  }

  contentEl.innerHTML = getSettingsContent();
  bindSettingsActions();
}

// ==================== 系统自动刷新 ====================

function syncSystemAutoRefresh(): void {
  if (appState.currentPage === "system" && systemState.appIsVisible) {
    startSystemAutoRefresh();
    systemService.startUptimeTicker(() => systemPage.renderAnchoredUptimeIfVisible());
    return;
  }

  systemService.stopAutoRefresh();
  systemService.stopUptimeTicker();
}

function startSystemAutoRefresh(): void {
  systemService.startAutoRefresh(async () => {
    await refreshSystemPageIfVisible();
  });
}

async function refreshSystemPageIfVisible(): Promise<void> {
  if (appState.currentPage !== "system" || !systemState.appIsVisible || systemState.refreshInFlight) {
    return;
  }

  const container = document.getElementById("content");
  if (!container) {
    return;
  }

  const renderEpoch = appState.pageRenderEpoch;
  systemState.refreshInFlight = true;
  try {
    const shouldUsePartialRefresh = container.querySelector("#system-dashboard") !== null && systemService.isSnapshotFresh();

    if (shouldUsePartialRefresh) {
      await systemPage.refreshPartial(container, renderEpoch);
    } else {
      await systemPage.render(container, renderEpoch);
    }
    if (container.querySelector("#system-dashboard") || systemState.snapshotCache !== null) {
      clearSystemLoadingWatchdog(true);
    }
  } catch (error) {
    if (!appState.isRenderStale(renderEpoch, "system")) {
      container.innerHTML = getErrorBlock("系统自动刷新失败", String(error));
    }
  } finally {
    systemState.refreshInFlight = false;
  }
}

// ==================== 恢复刷新处理 ====================

function onResumeRefresh(): void {
  syncSystemAutoRefresh();

  if (appState.currentPage === "docker") {
    dockerState.panelNeedsRefresh = true;
    dockerPage.refreshPageView();
  }

  if (appState.currentPage === "tools") {
    // Tools 页面自动刷新由页面内部管理
  }
}

