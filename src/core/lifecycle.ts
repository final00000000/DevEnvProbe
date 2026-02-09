/**
 * 应用生命周期核心模块
 */

import { systemState, appState, dockerState } from "../state";

/**
 * 初始化生命周期事件监听
 */
export function initLifecycleEvents(
  scheduleResumeRefresh: () => void
): void {
  const resume = () => {
    systemState.appIsVisible = true;
    scheduleResumeRefresh();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      systemState.appIsVisible = false;
      // 暂停自动刷新由调用方处理
      return;
    }

    resume();
  });

  window.addEventListener("focus", resume);
}

/**
 * 调度恢复刷新
 */
export function scheduleResumeRefresh(
  onResumeRefresh: () => void
): void {
  if (systemState.resumeRefreshTimer !== null) {
    window.clearTimeout(systemState.resumeRefreshTimer);
  }

  systemState.resumeRefreshTimer = window.setTimeout(() => {
    systemState.resumeRefreshTimer = null;

    if (appState.currentPage === "system") {
      systemState.resumeDeferUntilMs = Date.now() + 320;
    }

    onResumeRefresh();

    if (appState.currentPage === "docker") {
      dockerState.panelNeedsRefresh = true;
      // Docker 刷新由页面层处理
    }

    if (appState.currentPage === "tools") {
      // Tools 刷新由页面层处理
    }
  }, 120);
}
