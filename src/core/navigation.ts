/**
 * 页面导航核心模块
 */

import type { PageKey } from "../types";
import { appState, systemState, toolsState, dockerState } from "../state";
import { pages } from "../config/app-config";
import { cachePageRoot } from "./page-dom-cache";
import { NAV_RENDER_LOCK_MAX_MS, NAV_SWITCH_MIN_INTERVAL_MS } from "../constants/config";

let switchInFlight = false;
let queuedPage: PageKey | null = null;
let switchThrottleTimer: number | null = null;
let lastSwitchCompletedAt = 0;

export function resetNavigationRuntimeState(): void {
  switchInFlight = false;
  queuedPage = null;
  lastSwitchCompletedAt = 0;

  if (switchThrottleTimer !== null) {
    window.clearTimeout(switchThrottleTimer);
    switchThrottleTimer = null;
  }
}

/**
 * 初始化导航事件监听
 */
export function initNavigation(onSwitchPage: (page: PageKey) => Promise<void>): void {
  const navItems = document.querySelectorAll<HTMLAnchorElement>(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const page = item.dataset.page as PageKey | undefined;
      if (page && page in pages) {
        void onSwitchPage(page);
      }
    });
  });
}

/**
 * 切换页面
 */
export async function switchPage(
  page: PageKey,
  renderCurrentPage: (options?: { allowDomReuse?: boolean }) => Promise<void>,
  syncSystemAutoRefresh: () => void,
  onPageBeforeSwitch?: (previousPage: PageKey, nextPage: PageKey) => void
): Promise<void> {
  if (appState.currentPage === page && !switchInFlight) {
    return;
  }

  const now = Date.now();
  const elapsedSinceLastSwitch = now - lastSwitchCompletedAt;
  if (
    !switchInFlight &&
    appState.pageRenderEpoch > 0 &&
    lastSwitchCompletedAt > 0 &&
    elapsedSinceLastSwitch < NAV_SWITCH_MIN_INTERVAL_MS
  ) {
    queuedPage = page;

    if (switchThrottleTimer !== null) {
      window.clearTimeout(switchThrottleTimer);
    }

    const waitMs = Math.max(0, NAV_SWITCH_MIN_INTERVAL_MS - elapsedSinceLastSwitch);
    switchThrottleTimer = window.setTimeout(() => {
      switchThrottleTimer = null;
      const nextPage = queuedPage;
      queuedPage = null;
      if (nextPage && nextPage !== appState.currentPage) {
        void switchPage(nextPage, renderCurrentPage, syncSystemAutoRefresh, onPageBeforeSwitch);
      }
    }, waitMs);

    return;
  }

  if (switchInFlight) {
    queuedPage = page;
    return;
  }

  if (switchThrottleTimer !== null) {
    window.clearTimeout(switchThrottleTimer);
    switchThrottleTimer = null;
  }

  switchInFlight = true;

  try {
    if (appState.currentPage === page) {
      return;
    }

    const previousPage = appState.currentPage;
    cachePageRoot(previousPage);
    onPageBeforeSwitch?.(previousPage, page);
    appState.currentPage = page;

    // 更新导航激活状态
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.remove("active");
    });
    document.querySelector(`[data-page="${page}"]`)?.classList.add("active");

    // 更新页面标题
    const pageConfig = pages[page];
    const titleEl = document.getElementById("page-title");
    const subtitleEl = document.getElementById("page-subtitle");

    if (titleEl) {
      titleEl.textContent = pageConfig.title;
    }
    if (subtitleEl) {
      subtitleEl.textContent = pageConfig.subtitle;
    }

    // 停止所有定时器
    systemState.clearAllTimers();
    toolsState.clearAllTimers();
    dockerState.clearAllTimers();

    // 渲染新页面（限制导航锁等待时长，避免高频切页卡住）
    const renderTask = renderCurrentPage({ allowDomReuse: true }).catch(() => {
      // 渲染异常交由页面层兜底，此处保证导航状态机可继续前进
    });
    const lockReleaseTask = new Promise<void>((resolve) => {
      window.setTimeout(resolve, NAV_RENDER_LOCK_MAX_MS);
    });
    await Promise.race([renderTask, lockReleaseTask]);

    if (appState.currentPage === page) {
      syncSystemAutoRefresh();
      if (page === "docker" && !dockerState.bootstrapped) {
        window.setTimeout(() => {
          // Docker 初始化逻辑由页面层处理
        }, 80);
      }
    }
  } finally {
    switchInFlight = false;
    lastSwitchCompletedAt = Date.now();

    const nextPage = queuedPage;
    queuedPage = null;

    if (nextPage && nextPage !== appState.currentPage) {
      void switchPage(nextPage, renderCurrentPage, syncSystemAutoRefresh, onPageBeforeSwitch);
    }
  }
}
