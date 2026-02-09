import { invoke } from "@tauri-apps/api/core";
import {
  bindSettingsActions,
  ensureShellRuntimeStyles,
  getErrorBlock,
  getSettingsContent,
  initRefreshButton,
  initThemeToggle,
  loadThemePreference,
  showLoading,
} from "./modules/shell-ui";
import {
  buildDockerSummary,
  createEmptyDockerState,
  filterDockerContainers,
  firstMeaningfulLine,
  isContainerRunning,
  parseDockerCompose,
  parseDockerContainers,
  parseDockerImages,
  parseDockerStats,
} from "./modules/docker-data";
import { marketMetaMap, pages } from "./config/app-config";
import {
  createSystemTrendState,
  getSystemTrendCardsHtml,
  pushSystemTrendPoint,
  updateSystemTrendWidgets,
} from "./modules/system-trend";
import type {
  CommandResponse,
  DockerCommandResult,
  DockerDashboardState,
  DockerFilterState,
  DockerPanelTab,
  InstallResult,
  MarketMeta,
  PageKey,
  SystemRealtimeSnapshot,
  SystemSnapshot,
  ToolFilterState,
  ToolStatus,
} from "./types";
import {
  clampPercent,
  escapeHtml,
  formatGb,
  formatPercent,
  formatUptime,
  getBadgeClassByUsage,
  getProgressColorClass,
} from "./utils/formatters";

let currentPage: PageKey = "system";

let toolDataCache: ToolStatus[] = [];
let toolCategories: string[] = [];
let toolFilters: ToolFilterState = {
  search: "",
  status: "all",
  category: "all",
};

let installPath = "";
let installingKey: string | null = null;
let installLog = "等待安装任务...";
let installState = "";

let dockerStatus = "等待加载 Docker 数据";
let dockerOutput = "等待执行命令...";
let dockerPendingAction: string | null = null;
let dockerActiveTab: DockerPanelTab = "containers";
let dockerTarget = "";
let dockerBootstrapped = false;
let dockerFilters: DockerFilterState = {
  search: "",
  status: "all",
};
let dockerDashboard: DockerDashboardState = createEmptyDockerState();
let dockerLastOverviewAt = 0;
let dockerSearchDebounceTimer: number | null = null;
let dockerPanelNeedsRefresh = true;
const DOCKER_OVERVIEW_REFRESH_TTL_MS = 45_000;

let systemSnapshotCache: SystemSnapshot | null = null;
let systemRefreshLoopTimer: number | null = null;
let systemRefreshLoopActive = false;
let systemRefreshInFlight = false;
let systemUptimeTickTimer: number | null = null;
let systemUptimeAnchorSeconds = 0;
let systemUptimeAnchorAtMs = 0;
let appIsVisible = true;
let systemResumeDeferUntilMs = 0;
let resumeRefreshTimer: number | null = null;
let pageRenderEpoch = 0;
const SYSTEM_REFRESH_INTERVAL_MS = 1000;
const SYSTEM_SNAPSHOT_TTL_MS = 15000;
const systemTrendState = createSystemTrendState(60);
let systemSnapshotLastFetchedAt = 0;

let toolsLastScanAt = 0;
let toolsLastScanElapsedMs = 0;
let toolsDiffInstalled = 0;
let toolsDiffMissing = 0;
let toolsRefreshing = false;
let toolsGridRenderToken = 0;
let toolSearchDebounceTimer: number | null = null;
let toolsAutoRefreshTimer: number | null = null;
const TOOLS_GRID_BATCH_SIZE = 12;
const TOOLS_CACHE_TTL_MS = 120000;
const pageDomCache = new Map<PageKey, HTMLElement>();

window.addEventListener("DOMContentLoaded", () => {
  ensureShellRuntimeStyles();
  initNavigation();
  initThemeToggle();
  initRefreshButton(async () => {
    await renderCurrentPage({ allowDomReuse: false });
  });
  loadThemePreference();
  initLifecycleEvents();
  void (async () => {
    await renderCurrentPage();
    syncSystemAutoRefresh();
  })();
});

function initNavigation(): void {
  const navItems = document.querySelectorAll<HTMLAnchorElement>(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const page = item.dataset.page as PageKey | undefined;
      if (page && page in pages) {
        void switchPage(page);
      }
    });
  });
}

function initLifecycleEvents(): void {
  const resume = () => {
    appIsVisible = true;
    scheduleResumeRefresh();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      appIsVisible = false;
      syncSystemAutoRefresh();
      return;
    }

    resume();
  });

  window.addEventListener("focus", resume);
}

function scheduleResumeRefresh(): void {
  if (resumeRefreshTimer !== null) {
    window.clearTimeout(resumeRefreshTimer);
  }

  resumeRefreshTimer = window.setTimeout(() => {
    resumeRefreshTimer = null;

    if (currentPage === "system") {
      systemResumeDeferUntilMs = Date.now() + 320;
    }

    syncSystemAutoRefresh();

    if (currentPage === "docker") {
      dockerPanelNeedsRefresh = true;
      refreshDockerPageViewV2();
    }

    if (currentPage === "tools") {
      scheduleToolsCacheRefresh();
    }
  }, 120);
}

async function switchPage(page: PageKey): Promise<void> {
  if (currentPage === page) {
    return;
  }

  const previousPage = currentPage;
  cachePageRoot(previousPage);
  currentPage = page;

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });
  document.querySelector(`[data-page="${page}"]`)?.classList.add("active");

  const pageConfig = pages[page];
  const titleEl = document.getElementById("page-title");
  const subtitleEl = document.getElementById("page-subtitle");

  if (titleEl) {
    titleEl.textContent = pageConfig.title;
  }
  if (subtitleEl) {
    subtitleEl.textContent = pageConfig.subtitle;
  }

  stopSystemAutoRefresh();
  stopSystemUptimeTicker();

  if (toolSearchDebounceTimer !== null) {
    window.clearTimeout(toolSearchDebounceTimer);
    toolSearchDebounceTimer = null;
  }

  if (toolsAutoRefreshTimer !== null) {
    window.clearTimeout(toolsAutoRefreshTimer);
    toolsAutoRefreshTimer = null;
  }

  if (page !== "tools") {
    toolsGridRenderToken += 1;
  }

  void renderCurrentPage({ allowDomReuse: true }).finally(() => {
    if (currentPage === page) {
      syncSystemAutoRefresh();

      if (page === "docker" && !dockerBootstrapped) {
        window.setTimeout(() => {
          void refreshDockerOverviewIfStale();
        }, 80);
      }
    }
  });
}

interface RenderPageOptions {
  allowDomReuse?: boolean;
}

function cachePageRoot(page: PageKey, container?: HTMLElement | null): void {
  const host = container ?? document.getElementById("content");
  if (!host) {
    return;
  }

  const root = host.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    return;
  }

  if (page === "system" && root.id !== "system-dashboard") {
    return;
  }

  if (page === "tools" && root.id !== "tools-market-root") {
    return;
  }

  pageDomCache.set(page, root);
}

function restoreCachedPageRoot(container: HTMLElement, page: PageKey): boolean {
  const cachedRoot = pageDomCache.get(page);
  if (!cachedRoot) {
    return false;
  }

  container.replaceChildren(cachedRoot);
  return true;
}

async function renderCurrentPage(options: RenderPageOptions = {}): Promise<void> {
  const contentEl = document.getElementById("content");
  if (!contentEl) {
    return;
  }

  const renderEpoch = ++pageRenderEpoch;
  const targetPage = currentPage;

  if (options.allowDomReuse && (targetPage === "system" || targetPage === "tools")) {
    if (restoreCachedPageRoot(contentEl, targetPage)) {
      if (targetPage === "system") {
        renderAnchoredUptimeIfVisible();
      }

      if (targetPage === "tools") {
        scheduleToolsCacheRefresh(renderEpoch);
      }

      return;
    }
  }

  // 如果有缓存数据，立即显示，不显示loading
  const hasCache =
    (targetPage === "system" && systemSnapshotCache !== null) ||
    (targetPage === "tools" && toolDataCache.length > 0) ||
    (targetPage === "docker" && dockerBootstrapped);

  if (!hasCache) {
    // 首次加载显示友好提示
    if (targetPage === "system") {
      showLoading(contentEl, "正在采集系统信息（首次需要2秒建立基准）...");
    } else {
      showLoading(contentEl, "正在加载数据...");
    }
  }

  if (targetPage === "system") {
    await renderSystemPage(contentEl, renderEpoch);
    return;
  }

  if (targetPage === "tools") {
    await renderToolsPage(contentEl, renderEpoch);
    return;
  }

  if (targetPage === "docker") {
    await renderDockerPage(contentEl, renderEpoch);
    return;
  }

  if (isRenderStale(renderEpoch, targetPage)) {
    return;
  }

  contentEl.innerHTML = getSettingsContent();
  bindSettingsActions();
}

function isRenderStale(renderEpoch: number, page: PageKey): boolean {
  return renderEpoch !== pageRenderEpoch || currentPage !== page;
}

async function renderSystemPage(container: HTMLElement, renderEpoch?: number): Promise<void> {
  const now = Date.now();
  const snapshotFresh =
    systemSnapshotCache !== null && now - systemSnapshotLastFetchedAt < SYSTEM_SNAPSHOT_TTL_MS;

  // 如果有缓存，立即显示
  if (systemSnapshotCache && !container.querySelector("#system-dashboard")) {
    updateSystemUptimeAnchor(systemSnapshotCache.uptimeSeconds);
    renderSystemPageWithSnapshot(container, systemSnapshotCache, 0);
    renderAnchoredUptimeIfVisible();
  }

  if (snapshotFresh) {
    return;
  }

  // 异步获取新数据（不阻塞UI）
  const response = await invoke<CommandResponse<SystemSnapshot>>("get_system_snapshot");
  if (renderEpoch !== undefined && isRenderStale(renderEpoch, "system")) {
    return;
  }
  if (!response.ok || !response.data) {
    // 如果有缓存，保持显示缓存；否则显示错误
    if (!systemSnapshotCache) {
      container.innerHTML = getErrorBlock("系统信息获取失败", response.error ?? "未知错误");
    }
    return;
  }

  const snapshot = response.data;
  snapshot.cpuUsagePercent = clampPercent(snapshot.cpuUsagePercent);
  snapshot.memoryUsagePercent = clampPercent(snapshot.memoryUsagePercent);
  systemSnapshotCache = snapshot;
  systemSnapshotLastFetchedAt = Date.now();
  updateSystemUptimeAnchor(snapshot.uptimeSeconds);
  renderSystemPageWithSnapshot(container, snapshot, response.elapsedMs);
  renderAnchoredUptimeIfVisible();
}

function renderSystemPageWithSnapshot(container: HTMLElement, snapshot: SystemSnapshot, elapsedMs: number): void {
  const diskCount = snapshot.disks.length;
  const cpuUsagePercent = clampPercent(snapshot.cpuUsagePercent);
  const memoryUsagePercent = clampPercent(snapshot.memoryUsagePercent);
  const topCards = [
    getMetricCard("CPU 总占用", formatPercent(cpuUsagePercent, true), "实时总负载", "metric-trend-up", true),
    getMetricCard("内存占用", formatGb(snapshot.usedMemoryGb), "总内存 " + formatGb(snapshot.totalMemoryGb), "", false),
    getMetricCard("磁盘分区", String(diskCount), "已接入分区数量", "", false),
    getMetricCard("运行时长", formatUptime(snapshot.uptimeSeconds), "系统连续运行", "metric-trend-up", false),
  ].join("");

  pushSystemTrendPoint(systemTrendState, cpuUsagePercent, memoryUsagePercent);
  const trendCards = getSystemTrendCardsHtml(systemTrendState);

  const diskBlocks = snapshot.disks
    .map((disk) => {
      return `
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
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div id="system-dashboard" class="space-y-5">
      <div class="grid grid-cols-4 gap-4">${topCards}</div>

      <div class="grid grid-cols-2 gap-4">${trendCards}</div>

      <div class="grid grid-cols-3 gap-4">
        <div class="card col-span-2 animate-fade-in">
          <h3 class="text-lg font-semibold text-text-primary mb-3">系统资源概览</h3>
          <div class="space-y-3 text-sm">
            <div class="flex justify-between"><span class="text-text-secondary">采集耗时</span><span class="text-text-primary">${elapsedMs} ms</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">主机名</span><span class="text-text-primary">${escapeHtml(
              snapshot.hostName
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">操作系统</span><span class="text-text-primary">${escapeHtml(
              snapshot.osName
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">版本</span><span class="text-text-primary">${escapeHtml(
              snapshot.osVersion
            )} (build ${escapeHtml(snapshot.buildNumber)})</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">架构</span><span class="text-text-primary">${escapeHtml(
              snapshot.architecture
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">CPU</span><span class="text-text-primary">${escapeHtml(
              snapshot.cpuModel
            )}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">核心</span><span class="text-text-primary">${
              snapshot.cpuCores
            } 物理 / ${snapshot.cpuLogicalCores} 逻辑</span></div>
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

      <div class="grid grid-cols-3 gap-4">${diskBlocks}</div>
    </div>
  `;
}

async function refreshSystemSnapshotPartial(container: HTMLElement, renderEpoch: number): Promise<void> {
  const response = await invoke<CommandResponse<SystemRealtimeSnapshot>>("get_system_realtime");
  if (isRenderStale(renderEpoch, "system")) {
    return;
  }

  if (!response.ok || !response.data) {
    return;
  }

  const realtime = response.data;
  const cpuUsagePercent = clampPercent(realtime.cpuUsagePercent);
  const memoryUsagePercent = clampPercent(realtime.memoryUsagePercent);
  pushSystemTrendPoint(systemTrendState, cpuUsagePercent, memoryUsagePercent);
  applySystemRealtimeToCache(realtime);
  updateSystemUptimeAnchor(realtime.uptimeSeconds);

  if (!container.querySelector("#system-dashboard")) {
    return;
  }

  const metricValues = container.querySelectorAll<HTMLElement>(".metric-card .metric-value");
  if (metricValues.length >= 4) {
    metricValues[0].textContent = formatPercent(cpuUsagePercent, true);
    metricValues[1].textContent = formatGb(realtime.usedMemoryGb);
    metricValues[3].textContent = formatUptime(getAnchoredUptimeSeconds());
  }

  const metricSubtitles = container.querySelectorAll<HTMLElement>(".metric-card .text-xs");
  if (metricSubtitles.length >= 4) {
    metricSubtitles[1].textContent = `总内存 ${formatGb(realtime.totalMemoryGb)}`;
  }

  const infoRows = container.querySelectorAll<HTMLElement>(".card.col-span-2 .space-y-3 .flex.justify-between");
  if (infoRows.length > 0) {
    const elapsed = infoRows[0].querySelector<HTMLElement>("span:last-child");
    if (elapsed) {
      elapsed.textContent = `${response.elapsedMs} ms`;
    }
  }

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

  updateSystemTrendWidgets(container, systemTrendState, cpuUsagePercent, memoryUsagePercent);
}

function applySystemRealtimeToCache(realtime: SystemRealtimeSnapshot): void {
  if (!systemSnapshotCache) {
    return;
  }

  systemSnapshotCache.cpuUsagePercent = clampPercent(realtime.cpuUsagePercent);
  systemSnapshotCache.totalMemoryGb = realtime.totalMemoryGb;
  systemSnapshotCache.usedMemoryGb = realtime.usedMemoryGb;
  systemSnapshotCache.memoryUsagePercent = clampPercent(realtime.memoryUsagePercent);
  systemSnapshotCache.uptimeSeconds = realtime.uptimeSeconds;
}

function updateSystemUptimeAnchor(uptimeSeconds: number): void {
  systemUptimeAnchorSeconds = Math.max(0, Math.floor(uptimeSeconds));
  systemUptimeAnchorAtMs = Date.now();
}

function getAnchoredUptimeSeconds(): number {
  if (systemUptimeAnchorAtMs <= 0) {
    return systemUptimeAnchorSeconds;
  }

  const deltaSeconds = Math.floor((Date.now() - systemUptimeAnchorAtMs) / 1000);
  return systemUptimeAnchorSeconds + Math.max(0, deltaSeconds);
}

function renderAnchoredUptimeIfVisible(): void {
  if (currentPage !== "system" || !appIsVisible) {
    return;
  }

  const container = document.getElementById("content");
  if (!container) {
    return;
  }

  if (!container.querySelector("#system-dashboard")) {
    return;
  }

  const metricValues = container.querySelectorAll<HTMLElement>(".metric-card .metric-value");
  if (metricValues.length >= 4) {
    metricValues[3].textContent = formatUptime(getAnchoredUptimeSeconds());
  }
}

function startSystemUptimeTicker(): void {
  if (systemUptimeTickTimer !== null) {
    return;
  }

  systemUptimeTickTimer = window.setInterval(() => {
    renderAnchoredUptimeIfVisible();
  }, 1000);
}

function stopSystemUptimeTicker(): void {
  if (systemUptimeTickTimer !== null) {
    window.clearInterval(systemUptimeTickTimer);
    systemUptimeTickTimer = null;
  }
}

function syncSystemAutoRefresh(): void {
  if (currentPage === "system" && appIsVisible) {
    startSystemAutoRefresh();
    startSystemUptimeTicker();
    return;
  }

  stopSystemAutoRefresh();
  stopSystemUptimeTicker();
}

function startSystemAutoRefresh(): void {
  if (systemRefreshLoopActive) {
    return;
  }

  systemRefreshLoopActive = true;

  const runLoop = async (): Promise<void> => {
    if (!systemRefreshLoopActive) {
      return;
    }

    if (currentPage !== "system" || !appIsVisible) {
      stopSystemAutoRefresh();
      return;
    }

    const nowMs = Date.now();
    if (nowMs < systemResumeDeferUntilMs) {
      systemRefreshLoopTimer = window.setTimeout(() => {
        void runLoop();
      }, Math.max(80, systemResumeDeferUntilMs - nowMs));
      return;
    }

    const startedAt = performance.now();
    await refreshSystemPageIfVisible();

    if (!systemRefreshLoopActive) {
      return;
    }

    if (currentPage !== "system") {
      stopSystemAutoRefresh();
      return;
    }

    const elapsedMs = performance.now() - startedAt;
    const nextDelay = Math.max(220, Math.floor(SYSTEM_REFRESH_INTERVAL_MS - elapsedMs));

    systemRefreshLoopTimer = window.setTimeout(() => {
      void runLoop();
    }, nextDelay);
  };

  void runLoop();
}

function stopSystemAutoRefresh(): void {
  systemRefreshLoopActive = false;
  if (systemRefreshLoopTimer !== null) {
    window.clearTimeout(systemRefreshLoopTimer);
    systemRefreshLoopTimer = null;
  }
}

async function refreshSystemPageIfVisible(): Promise<void> {
  if (currentPage !== "system" || !appIsVisible || systemRefreshInFlight) {
    return;
  }

  const container = document.getElementById("content");
  if (!container) {
    return;
  }

  const renderEpoch = pageRenderEpoch;
  systemRefreshInFlight = true;
  try {
    if (container.querySelector("#system-dashboard")) {
      await refreshSystemSnapshotPartial(container, renderEpoch);
    } else {
      await renderSystemPage(container, renderEpoch);
    }
  } finally {
    systemRefreshInFlight = false;
  }
}

function getMetricCard(title: string, value: string, subtitle: string, trendClass: string, showCpuWarning: boolean = false): string {
  const warningIcon = showCpuWarning ? `
    <span class="cpu-warning-icon" title="CPU采样说明">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </span>
  ` : '';

  const tooltipContent = showCpuWarning ? `
    <div class="cpu-tooltip">
      <div class="cpu-tooltip-title">⚠️ CPU 采样说明</div>
      <div class="cpu-tooltip-content">
        <p><strong>本应用当前口径：</strong></p>
        <ul>
          <li><strong>优先：</strong>Processor Information(_Total) - % Processor Utility（任务管理器口径）</li>
          <li><strong>回退：</strong>Processor(_Total) - % Processor Time（传统忙碌比例）</li>
          <li><strong>最终回退：</strong>WMI PercentProcessorTime（系统预计算值）</li>
        </ul>
        <p><strong>为什么可能和任务管理器不完全一致？</strong></p>
        <ul>
          <li><strong>采样窗口：</strong>任务管理器会做平滑处理，采样窗口不同会造成偏差</li>
          <li><strong>刷新时点：</strong>本应用与任务管理器采样时刻不完全同步</li>
          <li><strong>口径差异：</strong>Utility 会考虑频率变化，和 Time 会有差异</li>
        </ul>
        <p><strong>可接受差异：</strong></p>
        <ul>
          <li>✅ <strong>&lt;2%：</strong>正常</li>
          <li>⚠️ <strong>2-5%：</strong>采样差异或负载波动</li>
          <li>❌ <strong>&gt;5%：</strong>建议对照任务管理器并反馈</li>
        </ul>
        <p><strong>对照建议：</strong></p>
        <ul>
          <li>TrafficMonitor/HWInfo 等通常显示 % Processor Time</li>
          <li>任务管理器通常显示 Utility（考虑频率）</li>
          <li>若差距较大，可用趋势曲线观察 5-10 秒平均值</li>
        </ul>
      </div>
    </div>
  ` : '';

  return `
    <div class="card metric-card animate-fade-in ${showCpuWarning ? 'has-cpu-warning' : ''}">
      <div class="text-sm text-text-secondary mb-2 flex items-center gap-2">
        ${escapeHtml(title)}
        ${warningIcon}
      </div>
      <div class="metric-value text-text-primary">${escapeHtml(value)}</div>
      <div class="text-xs ${trendClass || "text-text-muted"} mt-2">${escapeHtml(subtitle)}</div>
      ${tooltipContent}
    </div>
  `;
}

function isToolsCacheStale(): boolean {
  if (toolsLastScanAt === 0) {
    return true;
  }

  return Date.now() - toolsLastScanAt > TOOLS_CACHE_TTL_MS;
}

function scheduleToolsCacheRefresh(renderEpoch?: number): void {
  if (currentPage !== "tools" || !appIsVisible || toolsRefreshing || !isToolsCacheStale()) {
    return;
  }

  if (toolsAutoRefreshTimer !== null) {
    window.clearTimeout(toolsAutoRefreshTimer);
  }

  const epochWhenQueued = renderEpoch ?? pageRenderEpoch;
  toolsAutoRefreshTimer = window.setTimeout(() => {
    toolsAutoRefreshTimer = null;

    if (currentPage !== "tools" || !appIsVisible || toolsRefreshing || isRenderStale(epochWhenQueued, "tools")) {
      return;
    }

    void refreshToolsCache(true).then((ok) => {
      if (!ok || currentPage !== "tools" || isRenderStale(epochWhenQueued, "tools")) {
        return;
      }

      const contentEl = document.getElementById("content");
      if (contentEl) {
        renderToolsPageWithData(contentEl);
      }
    });
  }, 260);
}

async function refreshToolsCache(force: boolean): Promise<boolean> {
  if (toolsRefreshing) {
    return toolDataCache.length > 0;
  }

  if (!force && !isToolsCacheStale() && toolDataCache.length > 0) {
    return true;
  }

  toolsRefreshing = true;
  try {
    const response = await invoke<CommandResponse<ToolStatus[]>>("detect_dev_tools");
    if (!response.ok || !response.data) {
      return false;
    }

    applyToolsSnapshot(response.data, response.elapsedMs);
    return true;
  } finally {
    toolsRefreshing = false;
  }
}

function applyToolsSnapshot(nextTools: ToolStatus[], elapsedMs: number): void {
  const previousInstalledMap = new Map<string, boolean>();
  toolDataCache.forEach((tool) => {
    previousInstalledMap.set(getToolIdentity(tool), tool.installed);
  });

  let diffInstalled = 0;
  let diffMissing = 0;

  nextTools.forEach((tool) => {
    const key = getToolIdentity(tool);
    const previous = previousInstalledMap.get(key);
    if (previous === undefined) {
      return;
    }

    if (!previous && tool.installed) {
      diffInstalled += 1;
    }

    if (previous && !tool.installed) {
      diffMissing += 1;
    }
  });

  toolDataCache = nextTools;
  toolsDiffInstalled = diffInstalled;
  toolsDiffMissing = diffMissing;
  toolsLastScanAt = Date.now();
  toolsLastScanElapsedMs = elapsedMs;

  toolCategories = Array.from(new Set(toolDataCache.map((item) => item.category))).sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );

  if (!toolCategories.includes(toolFilters.category) && toolFilters.category !== "all") {
    toolFilters.category = "all";
  }
}

function getToolIdentity(tool: ToolStatus): string {
  return `${tool.name}::${tool.command}`;
}

function formatRelativeTime(timestamp: number): string {
  if (timestamp <= 0) {
    return "未探测";
  }

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 15_000) {
    return "刚刚";
  }

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

async function renderToolsPage(container: HTMLElement, renderEpoch?: number): Promise<void> {
  const hadSnapshot = toolDataCache.length > 0;

  if (hadSnapshot) {
    renderToolsPageWithData(container);
    scheduleToolsCacheRefresh(renderEpoch);

    return;
  }

  showLoading(container, "正在探测本机开发环境...");
  const loaded = await refreshToolsCache(true);
  if (renderEpoch !== undefined && isRenderStale(renderEpoch, "tools")) {
    return;
  }

  if (!loaded && toolDataCache.length === 0) {
    container.innerHTML = getErrorBlock("环境探测失败", "无法获取工具状态，请点击\"重新探测\"重试。");
    return;
  }

  renderToolsPageWithData(container);
}

function renderToolsPageWithData(container: HTMLElement): void {
  const installedCount = toolDataCache.filter((item) => item.installed).length;
  const changedText = toolsDiffInstalled === 0 && toolsDiffMissing === 0 ? "无变化" : `+${toolsDiffInstalled} / -${toolsDiffMissing}`;

  container.innerHTML = `
    <div id="tools-market-root" class="space-y-4">
      <div class="grid grid-cols-5 gap-3">
        <div class="card metric-card"><div class="text-sm text-text-secondary">工具总数</div><div class="metric-value">${toolDataCache.length}</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">已安装</div><div class="metric-value">${installedCount}</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">待安装</div><div class="metric-value">${
          toolDataCache.length - installedCount
        }</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">检测耗时</div><div class="metric-value">${toolsLastScanElapsedMs}ms</div></div>
        <div class="card metric-card"><div class="text-sm text-text-secondary">与上次差异</div><div class="metric-value">${escapeHtml(changedText)}</div></div>
      </div>

      <div class="card animate-fade-in">
        <div class="flex items-center justify-between mb-4 gap-3">
          <h3 class="text-lg font-semibold text-text-primary">环境市场</h3>
          <div class="text-xs text-text-secondary">上次探测：${escapeHtml(formatRelativeTime(toolsLastScanAt))}</div>
          <button id="tools-refresh-btn" class="btn btn-secondary" ${toolsRefreshing ? "disabled" : ""}>${
            toolsRefreshing ? "探测中..." : "重新探测"
          }</button>
        </div>

        <div class="grid grid-cols-4 gap-3 mb-4">
          <input id="tool-search" class="input col-span-2" placeholder="搜索技术栈、镜像、工具..." value="${escapeHtml(
            toolFilters.search
          )}" />
          <select id="tool-status-filter" class="select">
            <option value="all" ${toolFilters.status === "all" ? "selected" : ""}>全部状态</option>
            <option value="installed" ${toolFilters.status === "installed" ? "selected" : ""}>仅已安装</option>
            <option value="missing" ${toolFilters.status === "missing" ? "selected" : ""}>仅未安装</option>
          </select>
          <select id="tool-category-filter" class="select">
            <option value="all">全部分类</option>
            ${toolCategories
              .map((category) => {
                const selected = toolFilters.category === category ? "selected" : "";
                return `<option value="${escapeHtml(category)}" ${selected}>${escapeHtml(category)}</option>`;
              })
              .join("")}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-4">
          <input id="install-path" class="input col-span-2" placeholder="安装路径（可选，如 D:/DevTools）" value="${escapeHtml(
            installPath
          )}" />
          <button id="pick-install-path" class="btn btn-secondary">选择目录</button>
        </div>

        <div id="tools-grid" class="grid grid-cols-3 gap-4"></div>
      </div>

      <div class="card animate-fade-in">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-semibold text-text-primary">安装日志</h3>
          <span id="install-status" class="text-xs text-text-secondary">${escapeHtml(installState || "空闲")}</span>
        </div>
        <div id="install-log" class="install-log">${escapeHtml(installLog)}</div>
      </div>
    </div>
  `;

  renderToolsGrid();
  bindToolPageActions();
}

function bindToolPageActions(): void {
  const searchInput = document.getElementById("tool-search") as HTMLInputElement | null;
  const statusFilter = document.getElementById("tool-status-filter") as HTMLSelectElement | null;
  const categoryFilter = document.getElementById("tool-category-filter") as HTMLSelectElement | null;
  const pathInput = document.getElementById("install-path") as HTMLInputElement | null;
  const refreshBtn = document.getElementById("tools-refresh-btn") as HTMLButtonElement | null;
  const pickPathBtn = document.getElementById("pick-install-path") as HTMLButtonElement | null;

  searchInput?.addEventListener("input", () => {
    toolFilters.search = searchInput.value;

    if (toolSearchDebounceTimer !== null) {
      window.clearTimeout(toolSearchDebounceTimer);
    }

    toolSearchDebounceTimer = window.setTimeout(() => {
      toolSearchDebounceTimer = null;
      renderToolsGrid();
    }, 120);
  });

  statusFilter?.addEventListener("change", () => {
    toolFilters.status = statusFilter.value as ToolFilterState["status"];
    renderToolsGrid();
  });

  categoryFilter?.addEventListener("change", () => {
    toolFilters.category = categoryFilter.value;
    renderToolsGrid();
  });

  pathInput?.addEventListener("input", () => {
    installPath = pathInput.value;
  });

  refreshBtn?.addEventListener("click", async () => {
    if (toolsRefreshing) {
      return;
    }

    const ok = await refreshToolsCache(true);
    if (!ok || currentPage !== "tools") {
      return;
    }

    const contentEl = document.getElementById("content");
    if (contentEl) {
      await renderToolsPage(contentEl);
    }
  });

  pickPathBtn?.addEventListener("click", async () => {
    pickPathBtn.disabled = true;
    try {
      const response = await invoke<CommandResponse<string | null>>("pick_install_directory");
      if (!response.ok || !response.data) {
        return;
      }

      installPath = response.data;
      if (pathInput) {
        pathInput.value = installPath;
      }
    } finally {
      pickPathBtn.disabled = false;
    }
  });
}

function buildToolCardHtml(tool: ToolStatus): string {
  const meta = getMarketMeta(tool);
  const installKey = tool.installKey ?? "";
  const canInstall = installKey.length > 0;
  const installing = installingKey !== null && installingKey === installKey;
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

function renderToolsGrid(): void {
  const grid = document.getElementById("tools-grid");
  if (!grid) {
    return;
  }

  const filtered = filterTools(toolDataCache, toolFilters);
  const renderToken = ++toolsGridRenderToken;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="card col-span-3">当前筛选条件无结果</div>';
    return;
  }

  grid.innerHTML = "";

  const renderBatch = (startIndex: number): void => {
    if (renderToken !== toolsGridRenderToken || currentPage !== "tools") {
      return;
    }

    const endIndex = Math.min(startIndex + TOOLS_GRID_BATCH_SIZE, filtered.length);
    const batchHtml = filtered
      .slice(startIndex, endIndex)
      .map((tool) => buildToolCardHtml(tool))
      .join("");

    if (batchHtml) {
      grid.insertAdjacentHTML("beforeend", batchHtml);
    }

    if (endIndex < filtered.length) {
      window.requestAnimationFrame(() => renderBatch(endIndex));
      return;
    }

    bindInstallButtons();
  };

  renderBatch(0);
}

function bindInstallButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-install-key]");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const key = button.dataset.installKey;
      if (!key) {
        return;
      }
      await installTool(key);
    });
  });
}

async function installTool(itemKey: string): Promise<void> {
  installingKey = itemKey;
  installState = `安装中：${itemKey}`;
  appendInstallLog(`\n>>> 开始安装 ${itemKey}`);
  renderToolsGrid();
  renderInstallState();

  try {
    const response = await invoke<CommandResponse<InstallResult>>("install_market_item", {
      itemKey,
      installPath: installPath.trim() || null,
    });

    if (!response.ok || !response.data) {
      appendInstallLog(`安装失败：${response.error ?? "未知错误"}`);
      installState = "安装失败";
      return;
    }

    const result = response.data;
    appendInstallLog(`命令：${result.command}`);
    appendInstallLog(`返回码：${result.exitCode}`);
    if (result.stdout) {
      appendInstallLog(`stdout:\n${result.stdout}`);
    }
    if (result.stderr) {
      appendInstallLog(`stderr:\n${result.stderr}`);
    }

    if (result.exitCode === 0) {
      installState = "安装完成";
    } else {
      installState = "安装失败（返回码非 0）";
    }

    await refreshToolsCache(true);
  } catch (error) {
    appendInstallLog(`安装调用异常：${String(error)}`);
    installState = "安装异常";
  } finally {
    installingKey = null;
    renderToolsGrid();
    renderInstallState();
  }
}

function appendInstallLog(line: string): void {
  installLog = `${installLog}\n${line}`;
  const logEl = document.getElementById("install-log");
  if (logEl) {
    logEl.textContent = installLog;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function renderInstallState(): void {
  const stateEl = document.getElementById("install-status");
  if (stateEl) {
    stateEl.textContent = installState || "空闲";
  }
}

function filterTools(tools: ToolStatus[], filters: ToolFilterState): ToolStatus[] {
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

function getMarketMeta(tool: ToolStatus): MarketMeta {
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

async function renderDockerPage(container: HTMLElement, renderEpoch?: number): Promise<void> {
  await renderDockerPageV2(container, renderEpoch);
}

function bindDockerActions(): void {
  bindDockerActionsV2();
}

async function runDockerAction(action: string, target?: string): Promise<void> {
  await runDockerActionV2(action, target);
}

type DockerOverviewMode = "quick" | "full";

interface DockerRunOptions {
  switchTab?: boolean;
}

async function renderDockerPageV2(container: HTMLElement, renderEpoch?: number): Promise<void> {
  if (renderEpoch !== undefined && isRenderStale(renderEpoch, "docker")) {
    return;
  }

  const summary = dockerDashboard.summary;
  const lastCommand = dockerDashboard.lastCommand || "尚未执行";
  const pendingText = dockerPendingAction ? `执行中: ${dockerPendingAction}` : "空闲";
  const infoLine = dockerDashboard.infoText || "未获取 docker info";
  const versionLine = dockerDashboard.versionText || "未获取 docker version";

  container.innerHTML = `
    <div class="space-y-4 docker-page">
      <div id="docker-summary-grid" class="grid grid-cols-5 gap-3">
        ${renderDockerSummaryCardsV2()}
      </div>

      <div class="grid grid-cols-4 gap-4">
        <div class="card col-span-3 animate-fade-in">
          <h3 class="text-lg font-semibold text-text-primary mb-3">Docker 操作中心</h3>

          <div class="docker-toolbar mb-3">
            ${getDockerActionButton("version", "版本")}
            ${getDockerActionButton("info", "信息")}
            ${getDockerActionButton("ps", "容器列表")}
            ${getDockerActionButton("images", "镜像列表")}
            ${getDockerActionButton("stats", "资源统计")}
            ${getDockerActionButton("system_df", "磁盘占用")}
            ${getDockerActionButton("compose_ls", "Compose 项目")}
          </div>

          <div class="docker-input-group mb-3">
            <label class="text-sm text-text-secondary">容器名称 / ID</label>
            <div class="docker-target-row mt-2">
              <input id="docker-target" class="input flex-1" placeholder="例如: redis-dev" value="${escapeHtml(dockerTarget)}" />
              ${getDockerActionButton("start", "启动")}
              ${getDockerActionButton("stop", "停止")}
              ${getDockerActionButton("restart", "重启")}
              ${getDockerActionButton("logs", "日志")}
            </div>
          </div>

          <div class="docker-panel-tools mb-3">
            <div class="docker-tabs">
              <button class="docker-tab ${dockerActiveTab === "containers" ? "active" : ""}" data-docker-tab="containers">容器</button>
              <button class="docker-tab ${dockerActiveTab === "images" ? "active" : ""}" data-docker-tab="images">镜像</button>
              <button class="docker-tab ${dockerActiveTab === "stats" ? "active" : ""}" data-docker-tab="stats">资源监控</button>
              <button class="docker-tab ${dockerActiveTab === "compose" ? "active" : ""}" data-docker-tab="compose">Compose</button>
            </div>

            <div class="docker-filters">
              <input id="docker-search" class="input" placeholder="筛选容器/镜像/服务..." value="${escapeHtml(dockerFilters.search)}" />
              <select id="docker-status-filter" class="select">
                <option value="all" ${dockerFilters.status === "all" ? "selected" : ""}>全部状态</option>
                <option value="running" ${dockerFilters.status === "running" ? "selected" : ""}>仅运行中</option>
                <option value="exited" ${dockerFilters.status === "exited" ? "selected" : ""}>仅已停止</option>
              </select>
              <button id="docker-refresh-overview" class="btn btn-secondary" ${dockerPendingAction ? "disabled" : ""}>刷新概览</button>
            </div>
          </div>

          <div id="docker-structured-panel">
            ${renderDockerStructuredPanelV2()}
          </div>

          <details class="docker-raw-panel">
            <summary>原始命令输出（调试）</summary>
            <div id="docker-output" class="docker-output custom-scrollbar">${escapeHtml(dockerOutput)}</div>
          </details>
        </div>

        <div class="card animate-fade-in docker-side-panel">
          <h3 class="text-lg font-semibold text-text-primary mb-3">执行状态</h3>
          <div class="space-y-3 text-sm text-text-secondary">
            <div class="docker-side-meta">
              <span>状态</span>
              <span id="docker-status" class="badge badge-info">${escapeHtml(dockerStatus)}</span>
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
              <span id="docker-compose-count" class="docker-highlight">${summary.composeProjects}</span>
            </div>
            <div class="docker-side-meta">
              <span>平均 CPU</span>
              <span id="docker-avg-cpu" class="docker-highlight">${formatPercent(summary.avgCpuPercent)}</span>
            </div>
            <div class="docker-side-meta">
              <span>网络接收</span>
              <span id="docker-net-rx" class="docker-highlight">${escapeHtml(summary.netRxText)}</span>
            </div>
            <div class="docker-side-meta">
              <span>网络发送</span>
              <span id="docker-net-tx" class="docker-highlight">${escapeHtml(summary.netTxText)}</span>
            </div>

            <div class="text-xs text-text-muted">结构化表格用于日常查看，原始输出保留在折叠面板便于排错。</div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (renderEpoch !== undefined && isRenderStale(renderEpoch, "docker")) {
    return;
  }

  bindDockerActions();
  dockerPanelNeedsRefresh = false;

  if (!dockerBootstrapped) {
    dockerBootstrapped = true;
    // 使用 setTimeout 延迟初始化，避免阻塞页面渲染
    setTimeout(() => {
      void refreshDockerOverviewV2("quick");
    }, 100);
  }
}

function renderDockerSummaryCardsV2(): string {
  const summary = dockerDashboard.summary;
  return [
    getMetricCard("容器总数", String(summary.totalContainers), "包含运行中与停止实例", ""),
    getMetricCard("运行中", String(summary.runningContainers), "当前处于 Up 状态", "metric-trend-up"),
    getMetricCard("镜像数", String(summary.totalImages), "本地镜像存量", ""),
    getMetricCard("CPU 总占用", formatPercent(summary.totalCpuPercent), "容器资源总览", ""),
    getMetricCard(
      "内存占用",
      summary.memUsageText,
      summary.totalMemUsagePercent === null ? "执行 stats 后可见" : `占比 ${formatPercent(summary.totalMemUsagePercent)}`,
      ""
    ),
  ].join("");
}

function syncDockerActionButtonsV2(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-docker-action]");
  buttons.forEach((button) => {
    const action = button.dataset.dockerAction;
    const label = button.dataset.label ?? button.textContent ?? "执行";
    if (!action) {
      return;
    }

    const isBusy = dockerPendingAction !== null;
    const isRunning = dockerPendingAction === action;
    button.disabled = isBusy;
    button.classList.toggle("is-running", isRunning);
    button.textContent = isRunning ? "执行中..." : label;
  });
}

function bindDockerActionsV2(): void {
  const actionButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-action]");
  actionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.dockerAction;
      if (!action) {
        return;
      }

      const target = dockerTarget.trim();
      const requiresTarget = action === "start" || action === "stop" || action === "restart" || action === "logs";
      await runDockerAction(action, requiresTarget ? target || undefined : undefined);
    });
  });

  const targetInput = document.getElementById("docker-target") as HTMLInputElement | null;
  targetInput?.addEventListener("input", () => {
    dockerTarget = targetInput.value;
  });

  const searchInput = document.getElementById("docker-search") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    dockerFilters.search = searchInput.value;

    if (dockerSearchDebounceTimer !== null) {
      window.clearTimeout(dockerSearchDebounceTimer);
    }

    dockerSearchDebounceTimer = window.setTimeout(() => {
      dockerSearchDebounceTimer = null;
      updateDockerPanelSectionV2();
    }, 100);
  });

  const statusFilter = document.getElementById("docker-status-filter") as HTMLSelectElement | null;
  statusFilter?.addEventListener("change", () => {
    dockerFilters.status = statusFilter.value as DockerFilterState["status"];
    updateDockerPanelSectionV2();
  });

  const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-tab]");
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.dockerTab as DockerPanelTab | undefined;
      if (!tab) {
        return;
      }

      dockerActiveTab = tab;
      updateDockerPanelSectionV2();
    });
  });

  const refreshOverviewBtn = document.getElementById("docker-refresh-overview");
  refreshOverviewBtn?.addEventListener("click", () => {
    void refreshDockerOverviewV2("quick");
  });

  bindDockerRowActionsV2();
}

function bindDockerRowActionsV2(): void {
  const rowButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-row-action]");
  rowButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.dockerRowAction;
      const target = button.dataset.dockerTarget;
      if (!action || !target) {
        return;
      }

      dockerTarget = target;
      await runDockerAction(action, target);
    });
  });
}

function updateDockerPanelSectionV2(): void {
  const panel = document.getElementById("docker-structured-panel");
  if (panel) {
    const nextMarkup = renderDockerStructuredPanelV2();
    if (panel.innerHTML !== nextMarkup) {
      panel.innerHTML = nextMarkup;
      bindDockerRowActionsV2();
    }
  }

  const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-docker-tab]");
  tabButtons.forEach((button) => {
    const tab = button.dataset.dockerTab;
    button.classList.toggle("active", tab === dockerActiveTab);
  });

  dockerPanelNeedsRefresh = false;
}

function getDockerOverviewActions(mode: DockerOverviewMode): string[] {
  const quickActions = ["version", "ps", "images", "compose_ls"];
  if (dockerActiveTab === "stats") {
    quickActions.push("stats");
  }

  if (mode === "quick") {
    return quickActions;
  }

  return ["version", "info", "ps", "images", "stats", "compose_ls", "system_df"];
}

async function refreshDockerOverviewV2(mode: DockerOverviewMode = "quick"): Promise<void> {
  if (dockerPendingAction !== null) {
    return;
  }

  const taskName = mode === "quick" ? "quick-overview" : "overview";
  dockerPendingAction = taskName;
  dockerStatus = `执行中: ${taskName}`;
  dockerOutput = mode === "quick" ? "正在快速刷新 Docker 概览..." : "正在批量刷新 Docker 概览...";
  refreshDockerPageViewV2();

  const actions = getDockerOverviewActions(mode);

  try {
    for (const action of actions) {
      const response = await invoke<CommandResponse<DockerCommandResult>>("run_docker_action", {
        action,
      });

      if (!response.ok || !response.data) {
        continue;
      }

      const result = response.data;
      applyDockerActionResultV2(result, false);
      dockerOutput = `[${result.command}]\nexit=${result.exitCode}\n\n${result.stdout || "(无输出)"}${
        result.stderr ? `\n\n[stderr]\n${result.stderr}` : ""
      }`;
    }

    dockerLastOverviewAt = Date.now();
    dockerStatus = mode === "quick" ? "快速概览刷新完成" : "概览刷新完成";
  } catch (error) {
    dockerStatus = "概览刷新异常";
    dockerOutput = `调用异常\n${String(error)}`;
  } finally {
    dockerPendingAction = null;
    refreshDockerPageViewV2();
  }
}

async function refreshDockerOverviewIfStale(): Promise<void> {
  if (currentPage !== "docker" || !appIsVisible || dockerPendingAction !== null) {
    return;
  }

  const stale = Date.now() - dockerLastOverviewAt > DOCKER_OVERVIEW_REFRESH_TTL_MS;
  if (!stale) {
    return;
  }

  await refreshDockerOverviewV2("quick");
}

async function runDockerActionV2(action: string, target?: string, options: DockerRunOptions = {}): Promise<void> {
  const activeTabAtStart = dockerActiveTab;

  dockerPendingAction = action;
  dockerStatus = `执行中: ${action}`;
  dockerOutput = "执行中...";
  refreshDockerPageViewV2();

  try {
    const response = await invoke<CommandResponse<DockerCommandResult>>("run_docker_action", {
      action,
      target,
    });

    if (!response.ok || !response.data) {
      dockerStatus = `失败 · ${response.elapsedMs}ms`;
      dockerOutput = `执行失败\n${response.error ?? "未知错误"}`;
      dockerDashboard.rawOutput = dockerOutput;
      return;
    }

    const result = response.data;
    const stderr = result.stderr ? `\n\n[stderr]\n${result.stderr}` : "";
    dockerOutput = `[${result.command}]\nexit=${result.exitCode}\n\n${result.stdout || "(无输出)"}${stderr}`;
    dockerStatus = `${result.exitCode === 0 ? "成功" : "失败"} · ${response.elapsedMs}ms`;

    const switchTab = resolveDockerSwitchTabV2(action, options, activeTabAtStart);
    applyDockerActionResultV2(result, switchTab);

    if ((action === "start" || action === "stop" || action === "restart") && result.exitCode === 0) {
      void refreshDockerOverviewV2("quick");
    }
  } catch (error) {
    dockerStatus = "异常";
    dockerOutput = `调用异常\n${String(error)}`;
    dockerDashboard.rawOutput = dockerOutput;
  } finally {
    dockerPendingAction = null;
    refreshDockerPageViewV2();
  }
}

function resolveDockerSwitchTabV2(action: string, options: DockerRunOptions, activeTabAtStart: DockerPanelTab): boolean {
  if (options.switchTab === false) {
    return false;
  }

  const canSwitchTabByAction = action === "ps" || action === "images" || action === "stats" || action === "compose_ls";
  if (!canSwitchTabByAction) {
    return false;
  }

  if (options.switchTab === true) {
    return true;
  }

  return dockerActiveTab === activeTabAtStart;
}

function applyDockerActionResultV2(result: DockerCommandResult, switchTab: boolean): void {
  dockerDashboard.lastAction = result.action;
  dockerDashboard.lastCommand = result.command;
  dockerDashboard.rawOutput = dockerOutput;
  dockerPanelNeedsRefresh = true;

  switch (result.action) {
    case "version": {
      dockerDashboard.versionText = firstMeaningfulLine(result.stdout) ?? "(无输出)";
      break;
    }
    case "info": {
      dockerDashboard.infoText = firstMeaningfulLine(result.stdout) ?? "(无输出)";
      break;
    }
    case "ps": {
      dockerDashboard.containers = parseDockerContainers(result.stdout);
      if (switchTab) {
        dockerActiveTab = "containers";
      }
      break;
    }
    case "images": {
      dockerDashboard.images = parseDockerImages(result.stdout);
      if (switchTab) {
        dockerActiveTab = "images";
      }
      break;
    }
    case "stats": {
      dockerDashboard.stats = parseDockerStats(result.stdout);
      if (switchTab) {
        dockerActiveTab = "stats";
      }
      break;
    }
    case "compose_ls": {
      dockerDashboard.compose = parseDockerCompose(result.stdout);
      if (switchTab) {
        dockerActiveTab = "compose";
      }
      break;
    }
    case "system_df": {
      dockerDashboard.systemDf = result.stdout || "(无输出)";
      break;
    }
    default:
      break;
  }

  dockerDashboard.summary = buildDockerSummary(dockerDashboard);
}

function refreshDockerPageViewV2(): void {
  if (currentPage !== "docker") {
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
    void renderDockerPageV2(contentEl);
    return;
  }

  statusEl.textContent = dockerStatus;
  outputEl.textContent = dockerOutput;

  const pendingEl = document.getElementById("docker-pending");
  if (pendingEl) {
    pendingEl.textContent = dockerPendingAction ? `执行中: ${dockerPendingAction}` : "空闲";
  }

  const lastCommandEl = document.getElementById("docker-last-command");
  if (lastCommandEl) {
    lastCommandEl.textContent = dockerDashboard.lastCommand || "尚未执行";
  }

  const versionEl = document.getElementById("docker-version-line");
  if (versionEl) {
    versionEl.textContent = dockerDashboard.versionText || "未获取 docker version";
  }

  const infoEl = document.getElementById("docker-info-line");
  if (infoEl) {
    infoEl.textContent = dockerDashboard.infoText || "未获取 docker info";
  }

  const summaryGrid = document.getElementById("docker-summary-grid");
  if (summaryGrid) {
    const nextSummary = renderDockerSummaryCardsV2();
    if (summaryGrid.innerHTML !== nextSummary) {
      summaryGrid.innerHTML = nextSummary;
    }
  }

  const composeCountEl = document.getElementById("docker-compose-count");
  if (composeCountEl) {
    composeCountEl.textContent = String(dockerDashboard.summary.composeProjects);
  }

  const avgCpuEl = document.getElementById("docker-avg-cpu");
  if (avgCpuEl) {
    avgCpuEl.textContent = formatPercent(dockerDashboard.summary.avgCpuPercent);
  }

  const netRxEl = document.getElementById("docker-net-rx");
  if (netRxEl) {
    netRxEl.textContent = dockerDashboard.summary.netRxText;
  }

  const netTxEl = document.getElementById("docker-net-tx");
  if (netTxEl) {
    netTxEl.textContent = dockerDashboard.summary.netTxText;
  }

  if (dockerPanelNeedsRefresh) {
    const nextPanel = renderDockerStructuredPanelV2();
    if (structuredPanel.innerHTML !== nextPanel) {
      structuredPanel.innerHTML = nextPanel;
      bindDockerRowActionsV2();
    }
    dockerPanelNeedsRefresh = false;
  }

  syncDockerActionButtonsV2();
}

function renderDockerStructuredPanelV2(): string {
  if (dockerActiveTab === "containers") {
    return renderDockerContainerPanelV2();
  }

  if (dockerActiveTab === "images") {
    return renderDockerImagePanelV2();
  }

  if (dockerActiveTab === "stats") {
    return renderDockerStatsPanelV2();
  }

  return renderDockerComposePanelV2();
}

function renderDockerContainerPanelV2(): string {
  const rows = filterDockerContainers(dockerDashboard.containers, dockerFilters);
  if (rows.length === 0) {
    return getDockerEmptyStateV2("未匹配到容器数据，请先执行“容器列表”或“刷新概览”。");
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

function renderDockerImagePanelV2(): string {
  const search = dockerFilters.search.trim().toLowerCase();
  const rows = dockerDashboard.images.filter((item) => {
    if (!search) {
      return true;
    }

    return (
      item.repository.toLowerCase().includes(search) ||
      item.tag.toLowerCase().includes(search) ||
      item.id.toLowerCase().includes(search)
    );
  });

  if (rows.length === 0) {
    return getDockerEmptyStateV2("未匹配到镜像数据，请先执行“镜像列表”或“刷新概览”。");
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

function renderDockerStatsPanelV2(): string {
  const search = dockerFilters.search.trim().toLowerCase();
  const rows = dockerDashboard.stats.filter((item) => {
    if (!search) {
      return true;
    }

    return item.name.toLowerCase().includes(search);
  });

  if (rows.length === 0) {
    return getDockerEmptyStateV2("未匹配到资源监控数据，请先执行“资源统计”或“刷新概览”。");
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

function renderDockerComposePanelV2(): string {
  const search = dockerFilters.search.trim().toLowerCase();
  const rows = dockerDashboard.compose.filter((item) => {
    if (!search) {
      return true;
    }

    return (
      item.name.toLowerCase().includes(search) ||
      item.status.toLowerCase().includes(search) ||
      item.configFiles.toLowerCase().includes(search)
    );
  });

  if (rows.length === 0) {
    return getDockerEmptyStateV2("未匹配到 Compose 项目，请先执行“Compose 项目”或“刷新概览”。");
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

function getDockerEmptyStateV2(message: string): string {
  return `<div class="docker-empty">${escapeHtml(message)}</div>`;
}

function getDockerActionButton(action: string, label: string): string {
  const isBusy = dockerPendingAction !== null;
  const isRunning = dockerPendingAction === action;

  return `
    <button
      class="btn btn-secondary docker-action-btn ${isRunning ? "is-running" : ""}"
      data-docker-action="${action}"
      data-label="${label}"
      ${isBusy ? "disabled" : ""}
    >
      ${isRunning ? "执行中..." : label}
    </button>
  `;
}





























