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
import "./styles.css";
import { systemService, installPathPolicy, toolsService } from "./services";
import { systemPage, toolsPage, dockerPage } from "./pages";
import { MemoryMonitor } from "./utils/memory-monitor";
import {
  initNavigation,
  switchPage,
  initLifecycleEvents,
  clearPageDomCache,
  scheduleResumeRefresh,
  restoreCachedPageRoot,
} from "./core";
import {
  ensureShellRuntimeStyles,
  initRefreshButton,
  getSettingsContent,
  getErrorBlock,
  showLoading,
  showGlobalNotice,
} from "./modules/shell-ui";
import {
  applyTheme,
  bindThemeSettingsPanel,
  loadPersistedTheme,
  migrateLegacyThemeState,
} from "./modules/theme";
import {
  SYSTEM_INITIAL_LOADING_RETRY_MAX,
  SYSTEM_INITIAL_LOADING_WATCHDOG_MS,
} from "./constants/config";
import type { UpdateCheckResult, UpdateProgress } from "./services/update-service";

let systemLoadingWatchdogTimer: number | null = null;
let systemLoadingRetryBudget = SYSTEM_INITIAL_LOADING_RETRY_MAX;
const PROJECT_GITHUB_URL = "https://github.com/final00000000/DevEnvProbe";
const UPDATE_INTERACTION_LOCK_ID = "app-update-interaction-lock";
let updateInteractionLockDepth = 0;

type UpdateButtonMode = "footer" | "settings";

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
    const hasBootstrapState = container.querySelector("#system-bootstrap-state") !== null;
    const hasBootstrapError = container.querySelector('#system-bootstrap-state[data-bootstrap-kind="error"]') !== null;

    if (hasDashboard || systemState.snapshotCache !== null) {
      clearSystemLoadingWatchdog(true);
      return;
    }

    if (hasBootstrapError) {
      clearSystemLoadingWatchdog(false);
      return;
    }

    if (systemLoadingRetryBudget <= 0) {
      if (!hasBootstrapState) {
        showLoading(container, "系统信息采集中，请稍候...", {
          loadingId: "system-loading-panel",
          hint: "采集耗时较长时将自动继续重试，无需手动刷新。",
        });
      }
      return;
    }

    systemLoadingRetryBudget -= 1;
    void renderCurrentPage({ allowDomReuse: false });
  }, SYSTEM_INITIAL_LOADING_WATCHDOG_MS);
}

function formatDownloadedSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function normalizeUpdateErrorMessage(message: string): string {
  const normalized = message.trim();
  if (/No valid source result|所有版本源检查失败|no valid source/i.test(normalized)) {
    return "所有版本源检查失败，请先重新配置版本源后重试（Docker 页面可点击“配置源”）。";
  }
  return normalized.length > 0 ? normalized : "检查更新失败";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
  }
}

function ensureUpdateInteractionLockHost(): HTMLElement {
  const existing = document.getElementById(UPDATE_INTERACTION_LOCK_ID);
  if (existing) {
    return existing;
  }

  const host = document.createElement("div");
  host.id = UPDATE_INTERACTION_LOCK_ID;
  host.className = "app-interaction-lock";
  host.innerHTML = `
    <div class="app-interaction-lock-panel" role="status" aria-live="polite">
      <span class="app-interaction-lock-spinner" aria-hidden="true"></span>
      <span class="app-interaction-lock-text" data-lock-message>正在执行更新检查，请稍候...</span>
    </div>
  `;
  document.body.appendChild(host);
  return host;
}

function setUpdateInteractionLock(locked: boolean, message?: string): void {
  const host = ensureUpdateInteractionLockHost();
  const messageEl = host.querySelector<HTMLElement>("[data-lock-message]");
  if (messageEl && message) {
    messageEl.textContent = message;
  }

  if (locked) {
    updateInteractionLockDepth += 1;
    host.classList.add("is-active");
    document.body.classList.add("interaction-locked");
    return;
  }

  updateInteractionLockDepth = Math.max(0, updateInteractionLockDepth - 1);
  if (updateInteractionLockDepth === 0) {
    host.classList.remove("is-active");
    document.body.classList.remove("interaction-locked");
  }
}

async function openProjectRepository(): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(PROJECT_GITHUB_URL);
}

function bindGithubLink(link: HTMLAnchorElement | null): void {
  if (!link || link.dataset.bound === "true") {
    return;
  }

  link.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await openProjectRepository();
    } catch (error) {
      console.error("打开 GitHub 链接失败:", error);
    }
  });
  link.dataset.bound = "true";
}

function bindUpdateCheckAction(
  button: HTMLButtonElement,
  mode: UpdateButtonMode,
  statusTarget: HTMLElement | null = null
): void {
  if (button.dataset.updateBound === "true") {
    return;
  }

  const setSettingsButtonState = (
    state: "idle" | "checking" | "available" | "downloading" | "success" | "error" | "latest",
    text: string
  ): void => {
    if (mode !== "settings") return;
    button.dataset.updateState = state;
    button.textContent = text;
    button.classList.toggle("is-loading", state === "checking" || state === "downloading");
  };

  const setFooterUpdateState = (
    state: "idle" | "checking" | "available" | "downloading" | "success" | "error" | "latest",
    title: string
  ): void => {
    if (mode !== "footer") return;
    button.dataset.updateState = state;
    button.title = title;
    button.setAttribute("aria-label", title);
  };

  const setSettingsStatus = (message: string, level: "info" | "success" | "error" = "info"): void => {
    if (mode !== "settings" || !statusTarget) return;
    statusTarget.textContent = message;
    statusTarget.classList.remove("hidden");
    statusTarget.dataset.level = level;
  };

  const setAllUpdateButtonsDisabled = (disabled: boolean): void => {
    const allButtons = document.querySelectorAll<HTMLButtonElement>("#footer-check-update-btn, #check-update-btn");
    allButtons.forEach((current) => {
      current.disabled = disabled;
    });
  };

  const restoreIdle = (delayMs = 0): void => {
    // 终态后立即恢复全局交互，避免“已提示完成但仍在 loading”错觉。
    setUpdateInteractionLock(false);
    window.setTimeout(() => {
      setAllUpdateButtonsDisabled(false);
      if (mode === "footer") {
        setFooterUpdateState("idle", "检查应用更新");
      } else {
        setSettingsButtonState("idle", "检查更新");
      }
    }, delayMs);
  };

  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    setAllUpdateButtonsDisabled(true);
    if (mode === "footer") {
      setFooterUpdateState("checking", "检查中...");
    } else {
      setSettingsButtonState("checking", "检查中...");
      setSettingsStatus("正在检查更新，请稍候...", "info");
    }
    setUpdateInteractionLock(true, "正在检查更新，请稍候...");
    showGlobalNotice("检查更新", "正在连接更新源，请稍候...", "info", 1600);

    try {
      const { checkForUpdates, downloadAndInstall } = await import("./services/update-service");
      const updateResult: UpdateCheckResult = await withTimeout(
        checkForUpdates(),
        15_000,
        "检查更新超时，请检查网络或更新源配置"
      );

      if (updateResult.kind === "available") {
        if (mode === "footer") {
          setFooterUpdateState("available", `发现新版本 ${updateResult.version}`);
        } else {
          setSettingsButtonState("available", "发现新版本");
          setSettingsStatus(`发现新版本 ${updateResult.version}`, "info");
        }

        const shouldInstall = window.confirm(
          `发现新版本 ${updateResult.version}\n\n${updateResult.body || "无更新说明"}\n\n是否立即下载并安装?`
        );

        if (!shouldInstall) {
          if (mode === "settings") {
            setSettingsStatus("已取消本次更新", "info");
          }
          restoreIdle();
          return;
        }

        if (mode === "footer") {
          setFooterUpdateState("downloading", "下载中 0%");
        } else {
          setSettingsButtonState("downloading", "下载中...");
          setSettingsStatus("开始下载更新...", "info");
        }

        const success = await downloadAndInstall((progress: UpdateProgress) => {
          const progressText = progress.percentage > 0
            ? `下载中 ${progress.percentage.toFixed(0)}%`
            : `下载中 ${formatDownloadedSize(progress.downloaded)}`;
          if (mode === "footer") {
            setFooterUpdateState("downloading", progressText);
          } else {
            setSettingsButtonState("downloading", progressText);
            setSettingsStatus(progressText, "info");
          }
        });

        if (success) {
          if (mode === "footer") {
            setFooterUpdateState("success", "更新完成，应用即将重启");
          } else {
            setSettingsButtonState("success", "更新完成");
            setSettingsStatus("更新完成，应用即将重启...", "success");
          }
          restoreIdle(2200);
        } else {
          if (mode === "footer") {
            setFooterUpdateState("error", "更新失败");
          } else {
            setSettingsButtonState("error", "更新失败");
            setSettingsStatus("更新失败，请稍后重试", "error");
          }
          restoreIdle(2200);
        }
        return;
      }

      if (updateResult.kind === "latest") {
        if (mode === "footer") {
          setFooterUpdateState("latest", "当前已是最新版本");
          showGlobalNotice("检查更新", "当前已是最新版本", "success", 1800);
        } else {
          setSettingsButtonState("latest", "已是最新");
          setSettingsStatus("当前已是最新版本", "success");
        }
        restoreIdle(1800);
        return;
      }

      const errorMessage = normalizeUpdateErrorMessage(updateResult.message || "检查更新失败");
      if (mode === "footer") {
        setFooterUpdateState("error", errorMessage);
        showGlobalNotice("检查更新失败", errorMessage, "error", 2600);
      } else {
        setSettingsButtonState("error", "检查失败");
        setSettingsStatus(`检查更新失败：${errorMessage}`, "error");
      }
      restoreIdle(2200);
    } catch (error) {
      console.error("更新检查失败:", error);
      const detail = normalizeUpdateErrorMessage(error instanceof Error ? error.message : "检查更新失败");
      if (mode === "footer") {
        setFooterUpdateState("error", detail);
        showGlobalNotice("检查更新失败", detail, "error", 2600);
      } else {
        setSettingsButtonState("error", "检查失败");
        setSettingsStatus(`检查更新失败：${detail}`, "error");
      }
      restoreIdle(2200);
    }
  });

  button.dataset.updateBound = "true";
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
  migrateLegacyThemeState();
  applyTheme(loadPersistedTheme());
  initRefreshButton(async () => {
    if (appState.currentPage === "system") {
      await refreshSystemPageIfVisible();
      return;
    }

    if (appState.currentPage === "docker") {
      await dockerPage.refreshOverview("quick");
      return;
    }

    await renderCurrentPage({ allowDomReuse: false });
  });
  initLifecycleEvents(() => scheduleResumeRefresh(onResumeRefresh));

  bindGithubLink(document.getElementById("github-link") as HTMLAnchorElement | null);

  const footerCheckUpdateBtn = document.getElementById("footer-check-update-btn") as HTMLButtonElement | null;
  if (footerCheckUpdateBtn) {
    bindUpdateCheckAction(footerCheckUpdateBtn, "footer");
  }

  void import("./services/update-service")
    .then(({ silentCheckForUpdates }) => silentCheckForUpdates(5000))
    .catch((error) => {
      console.debug("静默更新检查失败:", error);
    });

  void renderCurrentPage();
  window.setTimeout(() => {
    syncSystemAutoRefresh();
  }, 600);

  // 预加载工具检测（后台异步执行，不阻塞 UI）
  window.setTimeout(() => {
    void toolsService.preloadDetection();
  }, 800);
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
      bindSystemRetryButton(contentEl);
    } catch (error) {
      if (!appState.isRenderStale(renderEpoch, "system")) {
        contentEl.innerHTML = getErrorBlock("系统首页渲染失败", String(error));
      }
      return;
    }

    const hasDashboard = contentEl.querySelector("#system-dashboard") !== null;
    const hasBootstrapState = contentEl.querySelector("#system-bootstrap-state") !== null;
    const hasBootstrapError = contentEl.querySelector('#system-bootstrap-state[data-bootstrap-kind="error"]') !== null;

    if (!hasDashboard && !hasBootstrapState && appState.currentPage === "system") {
      const detail = systemState.snapshotCache === null
        ? "首次采集耗时较长，正在后台持续重试..."
        : "当前使用缓存数据，后台正在继续同步最新指标。";
      showLoading(contentEl, "系统信息采集中，请稍候...", {
        loadingId: "system-loading-panel",
        hint: detail,
      });
    }

    if (hasDashboard || systemState.snapshotCache !== null || hasBootstrapError) {
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
  bindThemeSettingsPanel(contentEl);
  bindGithubLink(contentEl.querySelector<HTMLAnchorElement>("#settings-github-link"));

  const checkUpdateBtn = contentEl.querySelector<HTMLButtonElement>("#check-update-btn");
  if (checkUpdateBtn) {
    bindUpdateCheckAction(checkUpdateBtn, "settings", contentEl.querySelector<HTMLElement>("#update-status"));
  }

  // 绑定设置项持久化
  bindSettingsPersistence(contentEl);
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
    const hasDashboard = container.querySelector("#system-dashboard") !== null;

    if (hasDashboard) {
      await systemPage.refreshPartial(container, renderEpoch);

      if (!systemService.isSnapshotFresh()) {
        void systemService.fetchSystemSnapshot().then((snapshotResp) => {
          if (appState.isRenderStale(renderEpoch, "system")) return;
          if (snapshotResp.ok && snapshotResp.data) {
            systemPage.render(container, renderEpoch);
          }
        }).catch(() => {});
      }
    } else {
      // Bootstrap 去抖动：如果已有 bootstrap 状态且无缓存，只后台拉取，不重复渲染
      const hasBootstrapState = container.querySelector("#system-bootstrap-state") !== null;
      if (hasBootstrapState && systemState.snapshotCache === null) {
        const resp = await systemService.fetchSystemSnapshot();
        if (resp.ok && resp.data) {
          await systemPage.render(container, renderEpoch);
          bindSystemRetryButton(container);
        }
        return;
      }

      await systemPage.render(container, renderEpoch);
      bindSystemRetryButton(container);
    }

    const hasBootstrapError = container.querySelector('#system-bootstrap-state[data-bootstrap-kind="error"]') !== null;
    if (container.querySelector("#system-dashboard") || systemState.snapshotCache !== null || hasBootstrapError) {
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

function bindSystemRetryButton(container: ParentNode): void {
  const retryBtn = container.querySelector<HTMLButtonElement>("#system-retry-btn");
  if (!retryBtn || retryBtn.dataset.bound === "true") {
    return;
  }

  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "重试中...";

    try {
      await refreshSystemPageIfVisible();
    } finally {
      retryBtn.disabled = false;
      retryBtn.textContent = "立即重试";
    }
  });

  retryBtn.dataset.bound = "true";
}

// ==================== 设置页持久化 ====================

const SETTINGS_KEYS: ReadonlyArray<{ id: string; key: string; event: string; fallback?: string }> = [
  { id: "docker-path-input", key: "docker-path", event: "input" },
  { id: "docker-config-select", key: "docker-config", event: "change", fallback: "default" },
  { id: "package-manager-select", key: "package-manager", event: "change", fallback: "winget" },
];

function bindSettingsPersistence(container: HTMLElement): void {
  for (const { id, key, event, fallback } of SETTINGS_KEYS) {
    const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (!el) continue;

    el.value = localStorage.getItem(key) || fallback || "";

    el.addEventListener(event, () => {
      localStorage.setItem(key, el.value);
    });
  }

  const defaultInstallPathInput = container.querySelector<HTMLInputElement>("#default-install-path-input");
  const pickDefaultInstallPathBtn = container.querySelector<HTMLButtonElement>("#pick-default-install-path-btn");

  const persistDefaultInstallPath = (path: string): void => {
    installPathPolicy.setDefaultPath(path);
    clearPageDomCache("tools");
  };

  if (defaultInstallPathInput) {
    defaultInstallPathInput.value = installPathPolicy.getDefaultPath();
    defaultInstallPathInput.addEventListener("input", () => {
      persistDefaultInstallPath(defaultInstallPathInput.value);
    });
  }

  pickDefaultInstallPathBtn?.addEventListener("click", async () => {
    pickDefaultInstallPathBtn.disabled = true;

    try {
      const selectedPath = await installPathPolicy.pickInstallDirectory();
      if (!selectedPath || !defaultInstallPathInput) {
        return;
      }

      // 校验路径
      const validation = await installPathPolicy.validatePath(selectedPath);
      if (!validation.valid) {
        showGlobalNotice(
          "路径校验失败",
          validation.error || "所选路径无效",
          "error",
          3000
        );
        return;
      }

      defaultInstallPathInput.value = selectedPath;
      persistDefaultInstallPath(selectedPath);
    } catch (error) {
      console.error("选择安装目录失败:", error);
      showGlobalNotice(
        "选择目录失败",
        error instanceof Error ? error.message : "无法打开目录选择对话框，请检查权限设置",
        "error",
        3000
      );
    } finally {
      pickDefaultInstallPathBtn.disabled = false;
    }
  });
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
