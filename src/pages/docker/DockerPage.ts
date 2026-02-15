import { appState, deployState, dockerState, dockerVersionState } from "../../state";
import { deployService, dockerService, dockerVersionService } from "../../services";
import { versionConfigStorage } from "../../services/version-config-storage";
import { getDockerEmptyState, getDockerLoadingState, getDockerPanelSkeleton, getDockerSummarySkeletonCards, getMetricCard } from "../../ui";
import {
  DANGER_DOCKER_ACTIONS,
  SAFE_DOCKER_ACTIONS,
  findSelectionEntry,
  getDockerActionLabel,
  getDockerActionMeta,
  getSelectionEntries,
  loadDockerAdvancedMode,
  normalizeWorkbenchSelection,
  renderDockerOutputDrawer,
  resolveActionTarget,
  resolveDockerActionState,
  saveDockerAdvancedMode,
  shouldAutoOpenDockerOutputDrawer,
} from "../../modules/docker-workbench";
import {
  createInitialDeploySteps,
  DeployOrchestrator,
  renderDeployPipelineCard,
  resolveGitProjectPath,
  validateProfileForExecution,
} from "../../modules/deploy";
import { isContainerRunning } from "../../modules/docker-data";
import { debounce } from "../../utils/debounce";
import { escapeHtml, formatPercent, getBadgeClassByUsage } from "../../utils/formatters";
import { MemoryMonitor } from "../../utils/memory-monitor";
import { DOCKER_INIT_DELAY_MS, DOCKER_SEARCH_DEBOUNCE_MS } from "../../constants/config";
import { showGlobalNotice } from "../../modules/shell-ui";
import { renderSourceSelectionModalWithPreset, renderVersionManagementBlock } from "../../ui/docker-version-ui";
import type {
  DeployPipelineState,
  DeployProfile,
  DeployStepResult,
  DockerActionType,
  DockerPanelTab,
  DockerSelectionKind,
  VersionSourceConfig,
  VersionSourceKind,
  UpdateStepLog,
} from "../../types";
import type { DockerOverviewMode } from "../../services/docker-service";

interface ManagedListener {
  element: Element;
  event: string;
  handler: EventListener;
}

const TAB_LABEL: Record<DockerSelectionKind, string> = {
  container: "容器对象",
  image: "镜像对象",
  stat: "资源对象",
  compose: "Compose 对象",
};

const TAB_EMPTY: Record<DockerPanelTab, string> = {
  containers: "未匹配到容器，请调整筛选或刷新概览。",
  images: "未匹配到镜像，请调整筛选或刷新概览。",
  stats: "未匹配到资源数据，请执行资源监控后重试。",
  compose: "未匹配到 Compose 项目，请刷新概览。",
};

const DOCKER_VERSION_LOCK_ID = "docker-version-check-lock";

type DeployWorkflowMode = "start_only" | "pull_and_start";

export class DockerPage {
  private summaryCardsCache: string | null = null;
  private lastSummaryFingerprint: string | null = null;
  private lastDeployFingerprint: string | null = null;
  private pageListeners: ManagedListener[] = [];
  private memoryMonitorTimer: number | null = null;
  private panelUpdateRafId: number | null = null;
  private modalEscHandler: ((e: KeyboardEvent) => void) | null = null;
  private readonly debouncedUpdatePanel = debounce(() => this.requestPanelSectionUpdate(), DOCKER_SEARCH_DEBOUNCE_MS);
  private readonly deployOrchestrator = new DeployOrchestrator({
    executeStep: async (profile, step, selectedBranch) =>
      deployService.executeDeployStep({
        profile,
        step,
        selectedBranch: selectedBranch.trim().length > 0 ? selectedBranch : null,
      }),
  });

  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "docker")) return;

    this.clearExpiredDangerConfirm();
    if (!dockerState.bootstrapped) dockerState.advancedModeEnabled = loadDockerAdvancedMode();
    this.syncSelection();

    const showSkeleton = this.shouldRenderBootstrapSkeleton();
    const pendingText = dockerState.pendingAction ? `执行中: ${dockerState.pendingAction}` : dockerState.status;
    const lastCommand = dockerState.dashboard.lastCommand || "尚未执行";
    const versionLine = dockerState.dashboard.versionText || "未获取";

    container.innerHTML = `
      <div class="space-y-4 docker-page docker-workbench">
        <div id="docker-summary-grid" class="grid grid-cols-5 gap-3">${showSkeleton ? getDockerSummarySkeletonCards() : this.renderSummaryCards()}</div>
        <div class="card animate-fade-in docker-workbench-shell">
          <div class="docker-workbench-head">
            <div class="docker-workbench-status">
              <span id="docker-status" class="badge badge-info">${escapeHtml(pendingText)}</span>
              <span class="docker-workbench-meta-item">最后命令：<code id="docker-last-command" class="docker-status-cmd">${escapeHtml(lastCommand)}</code></span>
              <span class="docker-workbench-meta-item">Docker：<span id="docker-version-line">${escapeHtml(versionLine)}</span></span>
              <span class="docker-workbench-meta-item">概览刷新：<span id="docker-overview-time">${escapeHtml(this.formatOverviewRefreshedTime())}</span></span>
            </div>
            <div class="docker-workbench-head-actions">
              <button class="btn btn-secondary btn-xs" data-docker-refresh-overview ${dockerState.pendingAction ? "disabled" : ""}>刷新概览</button>
              <button class="btn btn-secondary btn-xs" data-docker-output-toggle>${dockerState.outputDrawerOpen ? "收起输出" : "查看输出"}</button>
              <label class="docker-workbench-advanced-switch" title="开启后显示删除容器/镜像等危险操作">
                <input id="docker-advanced-mode" type="checkbox" ${dockerState.advancedModeEnabled ? "checked" : ""} />
                <span>高级模式</span>
              </label>
            </div>
          </div>
          <div class="docker-workbench-body">
            <section class="docker-workbench-left">
              <div class="docker-tabs mb-3">
                <button class="docker-tab ${dockerState.activeTab === "containers" ? "active" : ""}" data-docker-tab="containers">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span>容器</span>
                </button>
                <button class="docker-tab ${dockerState.activeTab === "images" ? "active" : ""}" data-docker-tab="images">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>镜像</span>
                </button>
                <button class="docker-tab ${dockerState.activeTab === "stats" ? "active" : ""}" data-docker-tab="stats">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span>资源监控</span>
                </button>
                <button class="docker-tab ${dockerState.activeTab === "compose" ? "active" : ""}" data-docker-tab="compose">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                  </svg>
                  <span>Compose</span>
                </button>
              </div>
              <div class="docker-filters-row mb-3">
                <input id="docker-search" class="input flex-1" placeholder="搜索容器、镜像、项目..." value="${escapeHtml(dockerState.filters.search)}" />
                <div id="docker-status-filter-group" class="docker-workbench-status-group" style="${dockerState.activeTab === "containers" ? "" : "display:none"}">
                  <button type="button" class="docker-workbench-status-chip ${dockerState.filters.status === "all" ? "active" : ""}" data-docker-status-filter="all">全部状态</button>
                  <button type="button" class="docker-workbench-status-chip ${dockerState.filters.status === "running" ? "active" : ""}" data-docker-status-filter="running">运行中</button>
                  <button type="button" class="docker-workbench-status-chip ${dockerState.filters.status === "exited" ? "active" : ""}" data-docker-status-filter="exited">已停止</button>
                </div>
              </div>
              <div id="docker-workbench-left-list" class="docker-workbench-left-list custom-scrollbar">${this.renderList(showSkeleton)}</div>
            </section>
            <section id="docker-workbench-right-panel" class="docker-workbench-right">${this.renderDetail(showSkeleton)}</section>
          </div>
        </div>
        <div id="deploy-pipeline-host">${this.renderDeployPanel()}</div>
        <div id="docker-output-drawer-host">${renderDockerOutputDrawer({ open: dockerState.outputDrawerOpen, status: dockerState.status, output: dockerState.output, lastCommand })}</div>
      </div>
    `;

    this.lastDeployFingerprint = this.buildDeployFingerprint();

    if (renderEpoch !== undefined && appState.isRenderStale(renderEpoch, "docker")) return;
    this.bindDockerActions();
    dockerState.panelNeedsRefresh = false;

    if (!deployState.branchesLoading && deployState.availableBranches.length === 0 && deployState.activeProfile?.git.enabled) {
      void this.refreshDeployBranches();
    }

    if (!dockerState.bootstrapped) {
      dockerState.bootstrapped = true;
      window.setTimeout(() => void this.refreshOverviewWithUiSync("quick"), DOCKER_INIT_DELAY_MS);
    }

    if (import.meta.env.DEV) MemoryMonitor.getInstance().checkMemoryThreshold(80, "After DockerPage render");
    this.startMemoryMonitoring();
  }

  renderSummaryCards(): string {
    const s = dockerState.dashboard.summary;
    const fp = `${s.totalContainers}|${s.runningContainers}|${s.totalImages}|${s.totalCpuPercent}|${s.memUsageText}|${s.totalMemUsagePercent ?? "none"}|${dockerState.lastOverviewAt}|${dockerState.pendingAction ?? "idle"}`;
    if (this.summaryCardsCache && this.lastSummaryFingerprint === fp) return this.summaryCardsCache;

    const cards = dockerState.lastOverviewAt === 0
      ? this.renderSummaryPlaceholders(this.isOverviewLoading())
      : getMetricCard("容器总数", String(s.totalContainers), "包含运行中与停止实例", "")
        + getMetricCard("运行中", String(s.runningContainers), "当前处于 Up 状态", "metric-trend-up")
        + getMetricCard("镜像数", String(s.totalImages), "本地镜像存量", "")
        + getMetricCard("CPU 总占用", formatPercent(s.totalCpuPercent), "容器资源总览", "")
        + getMetricCard("内存占用", s.memUsageText, s.totalMemUsagePercent === null ? "执行 stats 后可见" : `占比 ${formatPercent(s.totalMemUsagePercent)}`, "");

    this.summaryCardsCache = cards;
    this.lastSummaryFingerprint = fp;
    return cards;
  }

  private renderSummaryPlaceholders(isLoading: boolean): string {
    const subtitle = isLoading ? "正在获取概览..." : "等待首次概览完成";
    return getMetricCard("容器总数", "--", subtitle, "")
      + getMetricCard("运行中", "--", subtitle, "")
      + getMetricCard("镜像数", "--", subtitle, "")
      + getMetricCard("CPU 总占用", "--", subtitle, "")
      + getMetricCard("内存占用", "待统计", subtitle, "");
  }

  private renderDeployPanel(): string {
    return renderDeployPipelineCard(
      deployState.profiles,
      deployState.selectedProfileId,
      deployState.selectedBranch,
      deployState.availableBranches,
      deployState.branchesLoading,
      deployState.pipeline,
      deployState.branchError,
      deployState.advancedConfigExpanded
    );
  }

  private buildDeployFingerprint(): string {
    const profileMarks = deployState.profiles
      .map((item) => `${item.id}:${item.updatedAt}:${item.mode}:${item.git.enabled ? "1" : "0"}`)
      .join("|");

    const stepMarks = deployState.pipeline.steps
      .map((item) => `${item.step}:${item.status}:${item.message}`)
      .join("|");

    return [
      profileMarks,
      deployState.selectedProfileId,
      deployState.selectedBranch,
      deployState.availableBranches.join("|"),
      deployState.branchesLoading ? "1" : "0",
      deployState.branchError ?? "",
      deployState.advancedConfigExpanded ? "1" : "0",
      deployState.pipeline.running ? "1" : "0",
      String(deployState.pipeline.lastRunAt),
      deployState.pipeline.lastError ?? "",
      deployState.pipeline.summary,
      String(deployState.pipeline.logs.length),
      stepMarks,
    ].join("||");
  }

  private async pickProjectDirectoryFor(fieldPath: "compose.projectPath" | "run.buildContext"): Promise<void> {
    const selectedPath = await deployService.pickProjectDirectory();
    if (!selectedPath) {
      return;
    }

    deployState.updateActiveProfileField(fieldPath, selectedPath);
    deployState.resetPipeline();
    deployState.branchError = null;
    deployState.setAvailableBranches([]);
    this.refreshPageView();

    if (deployState.activeProfile?.git.enabled) {
      await this.refreshDeployBranches();
    }
  }

  private async refreshDeployBranches(): Promise<void> {
    const profile = deployState.activeProfile;
    if (!profile || !profile.git.enabled) {
      deployState.branchError = null;
      deployState.setAvailableBranches([]);
      this.refreshPageView();
      return;
    }

    const projectPath = resolveGitProjectPath(profile);
    if (!projectPath) {
      deployState.branchError = "缺少 Git 项目目录，请先完善配置。";
      this.refreshPageView();
      return;
    }

    deployState.branchesLoading = true;
    deployState.branchError = null;
    this.refreshPageView();

    try {
      const response = await deployService.listGitBranches(projectPath);
      if (!response.ok || !response.data) {
        deployState.branchError = response.error ?? "分支获取失败";
        deployState.setAvailableBranches([]);
        showGlobalNotice("分支加载失败", deployState.branchError, "error");
        return;
      }

      deployState.setAvailableBranches(response.data);
      if (deployState.availableBranches.length === 0) {
        deployState.branchError = "未获取到任何分支，请确认该目录是 Git 仓库。";
        showGlobalNotice("未检测到分支", deployState.branchError, "info");
      }
    } catch (error) {
      deployState.branchError = String(error);
      deployState.setAvailableBranches([]);
      showGlobalNotice("分支加载异常", String(error), "error");
    } finally {
      deployState.branchesLoading = false;
      this.refreshPageView();
    }
  }

  private openDeployLogsInDrawer(): void {
    const logs = deployState.pipeline.logs;
    if (logs.length === 0) {
      dockerState.output = "暂无部署日志";
      dockerState.status = "部署日志";
      dockerState.outputDrawerOpen = true;
      this.refreshPageView();
      return;
    }

    const combined = logs
      .map((item) => {
        const lines = [
          `[${item.step}] ${item.ok ? "成功" : "失败"}${item.skipped ? "（已跳过）" : ""}`,
          ...item.commands.map((command) => `$ ${command}`),
          item.output || "(无输出)",
        ];

        if (item.error) {
          lines.push(`error: ${item.error}`);
        }

        return lines.join("\n");
      })
      .join("\n\n----------------------------------------\n\n");

    dockerState.output = combined;
    dockerState.status = deployState.pipeline.lastError ? "部署失败日志" : "部署执行日志";
    dockerState.outputDrawerOpen = true;
    this.refreshPageView();
  }

  private async copyOutputToClipboard(): Promise<void> {
    const text = dockerState.output.trim();
    if (text.length === 0) {
      showGlobalNotice("暂无可复制日志", "当前输出为空，请先执行命令或查看部署日志。", "info", 2200);
      return;
    }

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        showGlobalNotice("复制成功", "日志内容已复制到剪贴板。", "success", 2200);
        return;
      }
    } catch {}

    if (this.copyTextWithSelection(text)) {
      showGlobalNotice("复制成功", "日志内容已复制到剪贴板。", "success", 2200);
      return;
    }

    showGlobalNotice("复制失败", "当前环境不支持自动复制，请手动选中文本复制。", "error", 2800);
  }

  private copyTextWithSelection(text: string): boolean {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }

  private async runDeployPipeline(mode: DeployWorkflowMode): Promise<void> {
    if (deployState.pipeline.running) {
      return;
    }

    const profile = deployState.activeProfile;
    if (!profile) {
      showGlobalNotice("无法执行部署", "当前没有可用部署配置。", "error");
      return;
    }

    const execution = this.prepareDeployExecutionProfile(profile, mode);
    const executionProfile = execution.profile;
    if (execution.autoSkippedGit) {
      showGlobalNotice("已自动切换为镜像更新", "未配置项目目录，已跳过拉取代码，改为直接拉取镜像并启动。", "info", 3200);
    }

    if (mode === "start_only") {
      await this.runStartOnlyWorkflow(executionProfile);
      return;
    }

    if (executionProfile.git.enabled && (deployState.availableBranches.length === 0 || deployState.selectedBranch.trim().length === 0)) {
      await this.refreshDeployBranches();
      if (deployState.availableBranches.length === 0) {
        return;
      }
    }

    const selectedBranch = executionProfile.git.enabled ? deployState.selectedBranch.trim() : execution.selectedBranch;

    const validationError = validateProfileForExecution(executionProfile, selectedBranch);
    if (validationError) {
      showGlobalNotice("部署参数不完整", validationError, "error");
      return;
    }

    if (!this.confirmDeployPipelineRisk(executionProfile, selectedBranch, mode)) {
      return;
    }

    const nextState = await this.deployOrchestrator.run(
      executionProfile,
      selectedBranch,
      deployState.pipeline,
      (pipelineState) => {
        deployState.setPipeline(pipelineState);
        this.refreshPageView();
      }
    );

    deployState.setPipeline(nextState);
    this.refreshPageView();

    if (nextState.lastError) {
      showGlobalNotice("部署失败", nextState.lastError, "error");
      this.openDeployLogsInDrawer();
      return;
    }

    const deployModeText = executionProfile.mode === "run" ? "Run 容器重建" : "Compose 服务更新";
    const branchText = executionProfile.git.enabled && selectedBranch.length > 0 ? `，分支 ${selectedBranch}` : "";
    showGlobalNotice("部署完成", `${executionProfile.name} 已完成拉取新代码并启动（${deployModeText}${branchText}）。`, "success");
    await this.refreshOverviewWithUiSync("quick");
  }

  private prepareDeployExecutionProfile(
    profile: DeployProfile,
    mode: DeployWorkflowMode
  ): { profile: DeployProfile; selectedBranch: string; autoSkippedGit: boolean } {
    const selectedBranch = deployState.selectedBranch.trim();
    if (mode !== "pull_and_start") {
      return {
        profile,
        selectedBranch,
        autoSkippedGit: false,
      };
    }

    if (profile.mode !== "run" || profile.run.imageSource !== "pull" || !profile.git.enabled) {
      return {
        profile,
        selectedBranch,
        autoSkippedGit: false,
      };
    }

    const projectPath = resolveGitProjectPath(profile).trim();
    if (projectPath.length > 0) {
      return {
        profile,
        selectedBranch,
        autoSkippedGit: false,
      };
    }

    return {
      profile: {
        ...profile,
        git: {
          ...profile.git,
          enabled: false,
        },
      },
      selectedBranch: "",
      autoSkippedGit: true,
    };
  }

  private async runStartOnlyWorkflow(profile: DeployProfile): Promise<void> {
    if (profile.mode === "run" && profile.run.containerName.trim().length === 0) {
      showGlobalNotice("启动参数不完整", "Run 模式仅启动需要填写容器名称。", "error");
      return;
    }

    if (profile.mode === "compose") {
      const composeProfile = {
        ...profile,
        git: {
          ...profile.git,
          enabled: false,
        },
      };
      const validationError = validateProfileForExecution(composeProfile, "");
      if (validationError) {
        showGlobalNotice("启动参数不完整", validationError, "error");
        return;
      }
    }

    const nextState: DeployPipelineState = {
      running: true,
      lastRunAt: deployState.pipeline.lastRunAt,
      lastError: null,
      summary: "仅启动流程执行中...",
      steps: createInitialDeploySteps(),
      logs: [] as DeployStepResult[],
    };
    const pullStep = nextState.steps.find((item) => item.step === "pull_code");
    if (pullStep) {
      pullStep.status = "skipped";
      pullStep.message = "已跳过（仅启动）";
    }
    const stopStep = nextState.steps.find((item) => item.step === "stop_old");
    if (stopStep) {
      stopStep.status = "skipped";
      stopStep.message = "已跳过（仅启动）";
    }
    const deployStep = nextState.steps.find((item) => item.step === "deploy_new");
    if (deployStep) {
      deployStep.status = "running";
      deployStep.message = "执行中...";
    }

    deployState.setPipeline(nextState);
    this.refreshPageView();

    let stepResult: DeployStepResult;
    if (profile.mode === "run") {
      const containerName = profile.run.containerName.trim();
      const response = await dockerService.runDockerAction("start", containerName);
      if (!response.ok || !response.data) {
        const fallbackCommand = `docker start ${containerName}`;
        stepResult = {
          step: "deploy_new",
          ok: false,
          skipped: false,
          commands: [fallbackCommand],
          output: response.error ?? "命令执行失败",
          error: response.error ?? "命令执行失败",
          elapsedMs: response.elapsedMs,
        };
      } else {
        stepResult = this.buildDeployLogFromDockerResult(response.data, response.elapsedMs);
      }
    } else {
      const response = await deployService.executeDeployStep({
        profile: {
          ...profile,
          git: {
            ...profile.git,
            enabled: false,
          },
        },
        step: "deploy_new",
        selectedBranch: null,
      });
      if (!response.ok || !response.data) {
        stepResult = {
          step: "deploy_new",
          ok: false,
          skipped: false,
          commands: [],
          output: response.error ?? "命令执行失败",
          error: response.error ?? "命令执行失败",
          elapsedMs: response.elapsedMs,
        };
      } else {
        stepResult = response.data;
      }
    }

    nextState.logs = [stepResult];
    if (deployStep) {
      deployStep.status = stepResult.ok ? "success" : "failed";
      deployStep.message = stepResult.ok ? "执行成功" : stepResult.error ?? "执行失败";
    }

    nextState.running = false;
    nextState.lastRunAt = Date.now();

    if (!stepResult.ok) {
      const failedMessage = `仅启动失败：${stepResult.error ?? "命令执行失败"}`;
      nextState.lastError = failedMessage;
      nextState.summary = failedMessage;
      deployState.setPipeline(nextState);
      this.refreshPageView();
      showGlobalNotice("启动失败", failedMessage, "error");
      this.openDeployLogsInDrawer();
      return;
    }

    nextState.lastError = null;
    nextState.summary = `仅启动完成：${profile.name}`;
    deployState.setPipeline(nextState);
    this.refreshPageView();

    const targetText = profile.mode === "run" ? `容器 ${profile.run.containerName.trim()}` : "Compose 服务";
    showGlobalNotice("启动完成", `${profile.name} 已完成仅启动（${targetText}）。`, "success");
    await this.refreshOverviewWithUiSync("quick");
  }

  private buildDeployLogFromDockerResult(
    result: { command: string; stdout: string; stderr: string; exitCode: number },
    elapsedMs: number
  ): DeployStepResult {
    const output = this.formatDockerCommandOutput(result.command, result.stdout, result.stderr, result.exitCode);
    const detail = [result.stderr.trim(), result.stdout.trim()].find((item) => item.length > 0) ?? "命令执行失败";

    return {
      step: "deploy_new",
      ok: result.exitCode === 0,
      skipped: false,
      commands: [result.command],
      output,
      error: result.exitCode === 0 ? null : detail,
      elapsedMs,
    };
  }

  private formatDockerCommandOutput(command: string, stdout: string, stderr: string, exitCode: number): string {
    const stderrSection = stderr ? `\n\n[stderr]\n${stderr}` : "";
    return `[${command}]\nexit=${exitCode}\n\n${stdout || "(无输出)"}${stderrSection}`;
  }

  private confirmDeployPipelineRisk(profile: DeployProfile, selectedBranch: string, mode: DeployWorkflowMode): boolean {
    if (profile.mode !== "run" || mode !== "pull_and_start") {
      return true;
    }

    const lines: string[] = [
      "⚠️ 即将执行拉取新代码并启动（Run 模式）",
      "本次会先强制删除旧容器，再启动新容器。",
      `- 容器名称：${profile.run.containerName.trim() || "(未设置)"}`,
    ];

    if (profile.run.imageSource === "pull") {
      lines.push(`- 镜像策略：自动拉取最新镜像（${profile.run.imageRef.trim() || "(未设置)"}）`);
    } else {
      lines.push(`- 镜像策略：本地构建镜像（${profile.run.imageTag.trim() || "(未设置)"}）`);
    }

    if (profile.git.enabled && selectedBranch.length > 0) {
      lines.push(`- 代码分支：${selectedBranch}`);
    }

    lines.push("", "确认继续执行吗？");
    const confirmed = window.confirm(lines.join("\n"));
    if (!confirmed) {
      showGlobalNotice("已取消部署", "你取消了危险操作确认，部署流程未执行。", "info", 2200);
    }

    return confirmed;
  }

  private renderList(showSkeleton: boolean): string {
    if (showSkeleton) return getDockerPanelSkeleton();
    const entries = getSelectionEntries(dockerState.activeTab, dockerState.dashboard, dockerState.filters);
    if (entries.length === 0 && dockerState.pendingAction) return getDockerLoadingState();
    if (entries.length === 0) return getDockerEmptyState(TAB_EMPTY[dockerState.activeTab]);
    return `<ul class="docker-workbench-list-group">${entries.map((entry) => {
      const active = dockerState.selected?.kind === entry.kind && dockerState.selected?.key === entry.key;
      return `<li><button type="button" class="docker-workbench-item ${active ? "active" : ""}" data-docker-select-kind="${entry.kind}" data-docker-select-key="${escapeHtml(entry.key)}"><div class="docker-workbench-item-title">${escapeHtml(entry.title)}</div><div class="docker-workbench-item-subtitle">${escapeHtml(entry.subtitle)}</div></button></li>`;
    }).join("")}</ul>`;
  }

  private renderDetail(showSkeleton: boolean): string {
    if (showSkeleton) return getDockerPanelSkeleton();
    const entry = findSelectionEntry(dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
    if (!entry) return getDockerEmptyState("请先从左侧列表选择对象。");

    const safe = this.resolveSafeActions(entry.kind, entry.key);
    const primarySafeAction = safe[0] ?? null;
    const danger = DANGER_DOCKER_ACTIONS.filter((action) => getDockerActionMeta(action)?.supportKinds.includes(entry.kind));

    // Version management block for images
    let versionBlock = "";
    if (entry.kind === "image") {
      const imageKey = `${entry.title}:${entry.subtitle}`;
      const checkResult = dockerVersionState.getCheckResult(imageKey);
      const checking = dockerVersionState.isChecking(imageKey);
      const updating = dockerVersionState.isUpdating(imageKey);
      const imageState = dockerVersionState.byImageKey[imageKey];
      const progressLogs = imageState?.progressLogs || [];
      versionBlock = renderVersionManagementBlock(imageKey, checkResult, checking, updating, progressLogs);
    }

    return `
      <div class="docker-workbench-detail-card">
        ${versionBlock}
        <div class="docker-workbench-detail-head"><h3 class="docker-workbench-detail-title">${escapeHtml(entry.title)}</h3><span class="badge badge-info">${TAB_LABEL[entry.kind]}</span></div>
        <div class="docker-workbench-detail-subtitle">${escapeHtml(entry.subtitle)}</div>
        <div class="docker-workbench-detail-meta">${this.renderDetailMeta(entry.kind, entry.key)}</div>
        <div class="docker-workbench-action-section"><div class="docker-workbench-action-title">快捷操作</div><div class="docker-workbench-action-row docker-workbench-action-row-safe">${safe.map((action) => this.renderActionButton(action, entry.kind, false, action === primarySafeAction)).join("") || "<span class=\"text-text-muted\">当前对象无可执行快捷操作</span>"}</div>${this.renderSafeActionHint(entry.kind, primarySafeAction)}</div>
        ${dockerState.advancedModeEnabled && danger.length > 0 ? `<div class="docker-workbench-action-section is-danger"><div class="docker-workbench-action-title">危险操作（高级模式）</div><div class="docker-workbench-action-row">${danger.map((action) => this.renderActionButton(action, entry.kind, true)).join("")}</div>${this.renderDangerHint(entry.kind)}</div>` : ""}
      </div>
    `;
  }

  private renderDetailMeta(kind: DockerSelectionKind, key: string): string {
    if (kind === "container") {
      const item = dockerState.dashboard.containers.find((row) => row.id === key);
      if (!item) return '<div class="text-text-muted">容器信息已失效，请刷新概览。</div>';
      const running = isContainerRunning(item.status);
      return `<div class="docker-workbench-meta-grid"><div><span class="text-text-muted">容器 ID</span><code>${escapeHtml(item.id)}</code></div><div><span class="text-text-muted">状态</span><span class="badge ${running ? "badge-success" : "badge-warning"}">${escapeHtml(item.status)}</span></div><div><span class="text-text-muted">端口映射</span><span>${escapeHtml(item.ports || "--")}</span></div></div>`;
    }
    if (kind === "image") {
      const item = dockerState.dashboard.images.find((row) => row.id === key);
      if (!item) return '<div class="text-text-muted">镜像信息已失效，请刷新概览。</div>';
      return `<div class="docker-workbench-meta-grid"><div><span class="text-text-muted">仓库</span><span>${escapeHtml(item.repository)}</span></div><div><span class="text-text-muted">Tag</span><span>${escapeHtml(item.tag)}</span></div><div><span class="text-text-muted">镜像 ID</span><code>${escapeHtml(item.id)}</code></div><div><span class="text-text-muted">大小</span><span>${escapeHtml(item.size)}</span></div></div>`;
    }
    if (kind === "stat") {
      const item = dockerState.dashboard.stats.find((row) => row.name === key);
      if (!item) return '<div class="text-text-muted">资源信息已失效，请刷新概览。</div>';
      return `<div class="docker-workbench-meta-grid"><div><span class="text-text-muted">CPU</span><span class="badge ${getBadgeClassByUsage(item.cpuPercent)}">${escapeHtml(item.cpuText)}</span></div><div><span class="text-text-muted">内存</span><span>${escapeHtml(item.memUsageText)}</span></div><div><span class="text-text-muted">网络 IO</span><span>${escapeHtml(item.netIoText)}</span></div></div>`;
    }
    const item = dockerState.dashboard.compose.find((row) => row.name === key);
    if (!item) return '<div class="text-text-muted">Compose 信息已失效，请刷新概览。</div>';
    return `<div class="docker-workbench-meta-grid"><div><span class="text-text-muted">状态</span><span>${escapeHtml(item.status)}</span></div><div><span class="text-text-muted">配置文件</span><span>${escapeHtml(item.configFiles)}</span></div></div>`;
  }

  private renderActionButton(action: DockerActionType, kind: DockerSelectionKind, danger: boolean, primary = false): string {
    const target = resolveActionTarget(action, dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
    const state = resolveDockerActionState(action, kind, target, dockerState.pendingAction);
    const armed = danger && this.isDangerConfirmArmed(action, target);
    const label = danger && armed ? `确认${getDockerActionLabel(action)}` : getDockerActionLabel(action);
    const toneClass = danger ? "btn-secondary" : primary ? "btn-primary" : "btn-secondary";
    const classes = [
      "btn",
      toneClass,
      "btn-xs",
      "docker-workbench-action-btn",
      primary ? "is-primary" : "",
      danger ? "is-danger" : "",
      armed ? "is-armed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<button type="button" class="${classes}" data-docker-action="${action}" data-docker-target="${escapeHtml(target ?? "")}" title="${escapeHtml(state.reason ?? "")}" ${state.disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
  }

  private resolveSafeActions(kind: DockerSelectionKind, key: string): DockerActionType[] {
    if (kind === "image") {
      return ["run"];
    }

    if (kind !== "container") {
      return SAFE_DOCKER_ACTIONS.filter((action) => getDockerActionMeta(action)?.supportKinds.includes(kind));
    }

    const container = dockerState.dashboard.containers.find((row) => row.id === key);
    const running = container ? isContainerRunning(container.status) : false;

    if (running) {
      return ["stop", "restart", "logs"];
    }

    return ["start", "logs"];
  }

  private renderSafeActionHint(kind: DockerSelectionKind, primaryAction: DockerActionType | null): string {
    if (!primaryAction) {
      return "";
    }

    if (kind === "image" && primaryAction === "run") {
      return '<div class="docker-workbench-safe-hint">一键启动会基于当前镜像执行后台创建容器，容器名自动生成，无需命令行。</div>';
    }

    if (kind === "container" && primaryAction === "start") {
      return '<div class="docker-workbench-safe-hint">容器已停止，点击「启动」即可恢复运行。</div>';
    }

    if (kind === "container" && primaryAction === "stop") {
      return '<div class="docker-workbench-safe-hint">容器运行中，停止后会自动刷新列表并切回可启动状态。</div>';
    }

    return "";
  }

  private renderDangerHint(kind: DockerSelectionKind): string {
    const confirm = dockerState.dangerConfirm;
    if (!confirm || confirm.expiresAt < Date.now()) {
      return '<div class="docker-workbench-danger-hint">危险操作需二次确认，确认窗口 8 秒后自动失效。</div>';
    }
    const entry = findSelectionEntry(dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
    if (!entry || entry.kind !== kind || entry.target !== confirm.target) {
      return '<div class="docker-workbench-danger-hint">危险操作需二次确认，确认窗口 8 秒后自动失效。</div>';
    }
    return `<div class="docker-workbench-danger-hint is-armed">已进入确认态：再次点击「${escapeHtml(getDockerActionLabel(confirm.action))}」将立即执行。</div>`;
  }

  bindDockerActions(): void {
    this.removeManagedListeners(this.pageListeners);
    const root = document.querySelector(".docker-page");
    if (!root) return;

    this.addManaged(this.pageListeners, root, "click", async (event) => {
      const target = event.target as HTMLElement;

      const deployActionBtn = target.closest<HTMLButtonElement>("[data-deploy-action]");
      if (deployActionBtn) {
        const action = deployActionBtn.dataset.deployAction;
        if (!action) return;

        if (action === "toggle-advanced-config") {
          deployState.setAdvancedConfigExpanded(!deployState.advancedConfigExpanded);
          this.refreshPageView();
          return;
        }

        if (action === "choose-compose-project-dir") {
          await this.pickProjectDirectoryFor("compose.projectPath");
          return;
        }

        if (action === "choose-run-build-dir") {
          await this.pickProjectDirectoryFor("run.buildContext");
          return;
        }

        if (action === "add-profile") {
          deployState.addProfile("新部署配置");
          deployState.resetPipeline();
          deployState.branchError = null;
          deployState.setAvailableBranches([]);
          this.refreshPageView();
          return;
        }

        if (action === "save-profile") {
          showGlobalNotice("配置已保存", "部署配置已写入本地存储。", "success", 2000);
          return;
        }

        if (action === "delete-profile") {
          const profileName = deployState.activeProfile?.name ?? "当前配置";
          deployState.removeActiveProfile();
          deployState.resetPipeline();
          deployState.branchError = null;
          deployState.setAvailableBranches([]);
          showGlobalNotice("配置已删除", `${profileName} 已移除。`, "info", 2200);
          this.refreshPageView();
          return;
        }

        if (action === "refresh-branches") {
          await this.refreshDeployBranches();
          return;
        }

        if (action === "run-start-only") {
          await this.runDeployPipeline("start_only");
          return;
        }

        if (action === "run-pull-and-start" || action === "run-pipeline") {
          await this.runDeployPipeline("pull_and_start");
          return;
        }

        if (action === "view-log") {
          this.openDeployLogsInDrawer();
          return;
        }
      }

      const refreshBtn = target.closest<HTMLButtonElement>("[data-docker-refresh-overview]");
      if (refreshBtn) {
        if (!dockerState.pendingAction) await this.refreshOverviewWithUiSync("quick");
        return;
      }
      if (target.closest("[data-docker-output-toggle]")) {
        dockerState.outputDrawerOpen = !dockerState.outputDrawerOpen;
        this.refreshPageView();
        return;
      }
      if (target.closest("[data-docker-copy-output]")) {
        await this.copyOutputToClipboard();
        return;
      }
      if (target.closest("[data-docker-drawer-close]")) {
        dockerState.outputDrawerOpen = false;
        this.refreshPageView();
        return;
      }

      const tabBtn = target.closest<HTMLButtonElement>("[data-docker-tab]");
      if (tabBtn) {
        const tab = tabBtn.dataset.dockerTab;
        if (!tab || !this.isDockerPanelTab(tab)) return;
        dockerState.activeTab = tab;
        dockerState.dangerConfirm = null;

        if (dockerState.filters.search.trim().length > 0) {
          const nextEntries = getSelectionEntries(tab, dockerState.dashboard, dockerState.filters);
          if (nextEntries.length === 0) {
            dockerState.filters.search = "";
            const searchInput = document.getElementById("docker-search") as HTMLInputElement | null;
            if (searchInput) {
              searchInput.value = "";
            }
            showGlobalNotice("已清空搜索词", "切换分组后没有匹配项，已自动恢复完整列表。", "info", 2000);
          }
        }

        this.requestPanelSectionUpdate();
        return;
      }

      const statusChipBtn = target.closest<HTMLButtonElement>("[data-docker-status-filter]");
      if (statusChipBtn) {
        const status = statusChipBtn.dataset.dockerStatusFilter;
        if (status !== "all" && status !== "running" && status !== "exited") {
          return;
        }

        dockerState.filters.status = status;
        dockerState.dangerConfirm = null;
        this.requestPanelSectionUpdate();
        return;
      }

      const selectBtn = target.closest<HTMLButtonElement>("[data-docker-select-key]");
      if (selectBtn) {
        const kind = selectBtn.dataset.dockerSelectKind;
        const key = selectBtn.dataset.dockerSelectKey;
        if (!kind || !key || !this.isDockerSelectionKind(kind)) return;
        dockerState.selected = { kind, key };
        dockerState.dangerConfirm = null;
        this.requestPanelSectionUpdate();
        return;
      }

      // Version management actions
      const sourceModalOverlay = target.closest<HTMLElement>("#version-source-modal");
      if (sourceModalOverlay && target === sourceModalOverlay) {
        this.closeVersionSourceModal();
        return;
      }

      const sourceModalCloseBtn = target.closest<HTMLButtonElement>("#version-source-modal [data-modal-close]");
      if (sourceModalCloseBtn) {
        this.closeVersionSourceModal();
        return;
      }

      // Close modal when clicking overlay (outside modal content)
      const modalOverlay = target.closest<HTMLElement>("#version-source-modal.modal-overlay");
      if (modalOverlay && target === modalOverlay) {
        this.closeVersionSourceModal();
        return;
      }

      const sourceConfigBtn = target.closest<HTMLButtonElement>("[data-version-source-config]");
      if (sourceConfigBtn) {
        const imageKey = sourceConfigBtn.dataset.versionSourceConfig;
        if (!imageKey) return;
        this.openVersionSourceModal(imageKey);
        return;
      }

      const sourceConfirmBtn = target.closest<HTMLButtonElement>("[data-version-check-confirm]");
      if (sourceConfirmBtn) {
        const modal = document.getElementById("version-source-modal");
        if (!modal) {
          showGlobalNotice("配置未生效", "未找到配置弹窗，请重新打开版本源配置。", "error", 2600);
          return;
        }

        const imageKey = modal.dataset.imageKey;
        if (!imageKey) {
          showGlobalNotice("配置未生效", "未识别当前镜像，请重新打开版本源配置。", "error", 2600);
          return;
        }

        const selectedSources = Array.from(
          modal.querySelectorAll<HTMLInputElement>('input[name="version-source"]:checked')
        ).map((input) => input.value as VersionSourceKind);

        if (selectedSources.length === 0) {
          showGlobalNotice("请选择版本源", "至少启用一个版本源后再执行检查。", "error", 2600);
          return;
        }

        // Disable button and show loading state
        sourceConfirmBtn.disabled = true;
        const originalHtml = sourceConfirmBtn.innerHTML;
        sourceConfirmBtn.innerHTML = `
          <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>处理中...</span>
        `;

        try {
          const sources = this.buildVersionSources(imageKey, selectedSources);
          versionConfigStorage.saveConfig({ imageKey, sources });
          this.closeVersionSourceModal();
          await this.handleVersionCheck(imageKey, sources);
        } catch (error) {
          // Restore button state on error
          sourceConfirmBtn.disabled = false;
          sourceConfirmBtn.innerHTML = originalHtml;
          showGlobalNotice("操作失败", String(error), "error", 3000);
        }
        return;
      }

      const versionCheckBtn = target.closest<HTMLButtonElement>("[data-version-check]");
      if (versionCheckBtn) {
        const imageKey = versionCheckBtn.dataset.versionCheck;
        if (!imageKey) return;
        await this.handleVersionCheck(imageKey);
        return;
      }

      const versionUpdateBtn = target.closest<HTMLButtonElement>("[data-version-update]");
      if (versionUpdateBtn) {
        const imageKey = versionUpdateBtn.dataset.versionUpdate;
        const targetVersion = versionUpdateBtn.dataset.versionTarget;
        const source = versionUpdateBtn.dataset.versionSource;
        if (!imageKey || !targetVersion || !source) return;
        await this.handleVersionUpdate(imageKey, targetVersion, source as VersionSourceKind);
        return;
      }

      const actionBtn = target.closest<HTMLButtonElement>("[data-docker-action]");
      if (!actionBtn || dockerState.pendingAction) return;
      const actionRaw = actionBtn.dataset.dockerAction;
      if (!actionRaw || !this.isDockerActionType(actionRaw)) return;

      const action = actionRaw;
      const value = actionBtn.dataset.dockerTarget || resolveActionTarget(action, dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
      if (!value) {
        showGlobalNotice("无法执行操作", "当前选中项目标无效，请刷新概览后重试。", "error");
        return;
      }

      if (action === "rm" || action === "rmi") {
        const confirmed = dockerState.consumeDangerConfirm(action, value);
        if (!confirmed) {
          dockerState.armDangerConfirm(action, value);
          showGlobalNotice("危险操作确认", "请在 8 秒内再次点击同一按钮确认执行。", "info", 2600);
          this.refreshPageView();
          return;
        }
      }

      dockerState.target = value;
      await this.runDockerAction(action, value);
    });

    this.addManaged(this.pageListeners, root, "change", async (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

      const deployInput = target.dataset.deployInput;
      if (deployInput === "selectedProfileId") {
        deployState.selectProfile(target.value);
        deployState.resetPipeline();
        deployState.branchError = null;
        deployState.setAvailableBranches([]);
        this.refreshPageView();

        if (deployState.activeProfile?.git.enabled) {
          await this.refreshDeployBranches();
        }
        return;
      }

      if (deployInput === "selectedBranch") {
        deployState.setSelectedBranch(target.value);
        this.refreshPageView();
        return;
      }

      const fieldPath = target.dataset.deployField;
      if (!fieldPath) {
        return;
      }

      const nextValue = target instanceof HTMLInputElement && target.type === "checkbox"
        ? target.checked
        : target.value;

      deployState.updateActiveProfileField(fieldPath, nextValue);
      deployState.resetPipeline();

      if (fieldPath === "mode" || fieldPath === "compose.projectPath" || fieldPath === "run.buildContext" || fieldPath === "git.enabled") {
        deployState.branchError = null;
        deployState.setAvailableBranches([]);
      }

      this.refreshPageView();
    });

    const searchInput = document.getElementById("docker-search") as HTMLInputElement | null;
    this.addManaged(this.pageListeners, searchInput, "input", () => {
      if (!searchInput) return;
      dockerState.filters.search = searchInput.value;
      dockerState.dangerConfirm = null;
      this.debouncedUpdatePanel();
    });

    const advancedMode = document.getElementById("docker-advanced-mode") as HTMLInputElement | null;
    this.addManaged(this.pageListeners, advancedMode, "change", () => {
      if (!advancedMode) return;
      dockerState.advancedModeEnabled = advancedMode.checked;
      dockerState.dangerConfirm = null;
      saveDockerAdvancedMode(advancedMode.checked);
      dockerState.panelNeedsRefresh = true;
      this.refreshPageView();
    });
  }

  async runDockerAction(action: DockerActionType, target?: string): Promise<void> {
    const tabAtStart = dockerState.activeTab;
    let shouldRefreshOverview = false;
    let shouldResetContainerStatusFilter = false;
    let filterResetMessage = "";
    let successNotice = "";

    dockerState.setPendingAction(action);
    dockerState.output = "执行中...";
    this.refreshPageView();

    try {
      const response = await dockerService.runDockerAction(action, target);
      if (!response.ok || !response.data) {
        dockerState.status = `失败 · ${response.elapsedMs}ms`;
        dockerState.output = `执行失败\n${response.error ?? "未知错误"}`;
        dockerState.dashboard.rawOutput = dockerState.output;
        dockerState.outputDrawerOpen = true;
        return;
      }

      const result = response.data;
      const stderr = result.stderr ? `\n\n[stderr]\n${result.stderr}` : "";
      dockerState.output = `[${result.command}]\nexit=${result.exitCode}\n\n${result.stdout || "(无输出)"}${stderr}`;
      dockerState.status = `${result.exitCode === 0 ? "成功" : "失败"} · ${response.elapsedMs}ms`;

      const switchTab = (action === "ps" || action === "images" || action === "stats" || action === "compose_ls") && dockerState.activeTab === tabAtStart;
      dockerService.applyActionResult(result, switchTab);
      if (shouldAutoOpenDockerOutputDrawer(action, result.exitCode)) dockerState.outputDrawerOpen = true;

      if ((action === "run" || action === "start" || action === "stop" || action === "restart" || action === "rm" || action === "rmi") && result.exitCode === 0) {
        shouldRefreshOverview = true;
      }

      if (result.exitCode === 0 && action === "run") {
        const createdContainerId = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);

        dockerState.activeTab = "containers";
        dockerState.filters.status = "all";
        dockerState.selected = null;

        successNotice = createdContainerId
          ? `镜像已启动，容器 ID: ${createdContainerId.slice(0, 12)}`
          : "镜像已启动并创建新容器。";
      }

      if (result.exitCode === 0 && dockerState.activeTab === "containers") {
        if (action === "stop" && dockerState.filters.status === "running") {
          dockerState.filters.status = "all";
          shouldResetContainerStatusFilter = true;
          filterResetMessage = "容器已停止，已自动切换到“全部状态”，方便继续执行启动。";
        }

        if (action === "start" && dockerState.filters.status === "exited") {
          dockerState.filters.status = "all";
          shouldResetContainerStatusFilter = true;
          filterResetMessage = "容器已启动，已自动切换到“全部状态”，方便继续观察。";
        }
      }
    } catch (error) {
      dockerState.status = "异常";
      dockerState.output = `调用异常\n${String(error)}`;
      dockerState.dashboard.rawOutput = dockerState.output;
      dockerState.outputDrawerOpen = true;
    } finally {
      dockerState.pendingAction = null;
      if (shouldResetContainerStatusFilter) {
        dockerState.panelNeedsRefresh = true;
      }
      this.refreshPageView();

      if (shouldResetContainerStatusFilter) {
        showGlobalNotice("筛选已自动调整", filterResetMessage, "info", 3000);
      }

      if (successNotice) {
        showGlobalNotice("操作成功", successNotice, "success", 3200);
      }

      if (shouldRefreshOverview) {
        void this.refreshOverviewWithUiSync("quick");
      }
    }
  }

  async refreshOverview(mode: DockerOverviewMode = "quick"): Promise<void> {
    if (dockerState.pendingAction !== null) {
      return;
    }

    await this.refreshOverviewWithUiSync(mode);
  }

  updatePanelSection(): void {
    if (appState.currentPage !== "docker") return;
    this.syncSelection();
    dockerState.panelNeedsRefresh = true;
    this.refreshPageView();
  }

  refreshPageView(): void {
    if (appState.currentPage !== "docker") return;
    const content = document.getElementById("content");
    if (!content) return;
    const root = content.querySelector(".docker-page");
    if (!root) {
      void this.render(content);
      return;
    }

    this.clearExpiredDangerConfirm();
    this.syncSelection();

    const showSkeleton = this.shouldRenderBootstrapSkeleton();
    const pendingText = dockerState.pendingAction ? `执行中: ${dockerState.pendingAction}` : dockerState.status;
    const updateText = (id: string, value: string): void => {
      const el = document.getElementById(id);
      if (el && el.textContent !== value) el.textContent = value;
    };

    updateText("docker-status", pendingText);
    updateText("docker-last-command", dockerState.dashboard.lastCommand || "尚未执行");
    updateText("docker-version-line", dockerState.dashboard.versionText || "未获取");
    updateText("docker-overview-time", this.formatOverviewRefreshedTime());

    const summaryGrid = document.getElementById("docker-summary-grid");
    if (summaryGrid) {
      const html = showSkeleton ? getDockerSummarySkeletonCards() : this.renderSummaryCards();
      if (summaryGrid.innerHTML !== html) summaryGrid.innerHTML = html;
    }

    const deployHost = document.getElementById("deploy-pipeline-host");
    if (deployHost) {
      const deployFingerprint = this.buildDeployFingerprint();
      if (deployFingerprint !== this.lastDeployFingerprint) {
        deployHost.innerHTML = this.renderDeployPanel();
        this.lastDeployFingerprint = deployFingerprint;
      }
    }

    if (dockerState.panelNeedsRefresh || showSkeleton) {
      const listHost = document.getElementById("docker-workbench-left-list");
      if (listHost) {
        const html = this.renderList(showSkeleton);
        if (listHost.innerHTML !== html) listHost.innerHTML = html;
      }

      const detailHost = document.getElementById("docker-workbench-right-panel");
      if (detailHost) {
        const html = this.renderDetail(showSkeleton);
        if (detailHost.innerHTML !== html) detailHost.innerHTML = html;
      }

      dockerState.panelNeedsRefresh = false;
    }

    document.querySelectorAll<HTMLButtonElement>("[data-docker-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.dockerTab === dockerState.activeTab);
    });

    const statusFilterGroup = document.getElementById("docker-status-filter-group") as HTMLElement | null;
    if (statusFilterGroup) {
      statusFilterGroup.style.display = dockerState.activeTab === "containers" ? "" : "none";

      statusFilterGroup
        .querySelectorAll<HTMLButtonElement>("[data-docker-status-filter]")
        .forEach((button) => {
          const status = button.dataset.dockerStatusFilter;
          button.classList.toggle("active", status === dockerState.filters.status);
        });
    }

    const outputBtn = document.querySelector<HTMLButtonElement>("[data-docker-output-toggle]");
    if (outputBtn) outputBtn.textContent = dockerState.outputDrawerOpen ? "收起输出" : "查看输出";
    const advancedMode = document.getElementById("docker-advanced-mode") as HTMLInputElement | null;
    if (advancedMode) advancedMode.checked = dockerState.advancedModeEnabled;

    const drawerHost = document.getElementById("docker-output-drawer-host");
    if (drawerHost) {
      const html = renderDockerOutputDrawer({
        open: dockerState.outputDrawerOpen,
        status: dockerState.status,
        output: dockerState.output,
        lastCommand: dockerState.dashboard.lastCommand || "尚未执行",
      });
      if (drawerHost.innerHTML !== html) drawerHost.innerHTML = html;
    }
  }

  private syncSelection(): void {
    dockerState.selected = normalizeWorkbenchSelection(dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
    const entry = findSelectionEntry(dockerState.activeTab, dockerState.dashboard, dockerState.filters, dockerState.selected);
    dockerState.target = entry?.target ?? "";
    if (!dockerState.advancedModeEnabled) dockerState.dangerConfirm = null;
    if (dockerState.dangerConfirm && dockerState.dangerConfirm.expiresAt < Date.now()) dockerState.dangerConfirm = null;
    if (dockerState.dangerConfirm && (!entry || entry.target !== dockerState.dangerConfirm.target)) dockerState.dangerConfirm = null;
  }

  private isDangerConfirmArmed(action: DockerActionType, target: string | null): boolean {
    if (!target || !dockerState.dangerConfirm) return false;
    if (dockerState.dangerConfirm.expiresAt < Date.now()) {
      dockerState.dangerConfirm = null;
      return false;
    }
    return dockerState.dangerConfirm.action === action && dockerState.dangerConfirm.target === target;
  }

  private clearExpiredDangerConfirm(): void {
    if (dockerState.dangerConfirm && dockerState.dangerConfirm.expiresAt < Date.now()) dockerState.dangerConfirm = null;
  }

  private formatOverviewRefreshedTime(): string {
    if (dockerState.lastOverviewAt <= 0) return "未刷新";
    return new Date(dockerState.lastOverviewAt).toLocaleTimeString("zh-CN", { hour12: false });
  }

  private isOverviewLoading(): boolean {
    return dockerState.pendingAction === "quick-overview" || dockerState.pendingAction === "overview";
  }

  private shouldRenderBootstrapSkeleton(): boolean {
    if (dockerState.lastOverviewAt > 0) return false;
    return !dockerState.bootstrapped || this.isOverviewLoading();
  }

  private async refreshOverviewWithUiSync(mode: DockerOverviewMode = "quick"): Promise<void> {
    if (appState.currentPage === "docker") {
      dockerState.panelNeedsRefresh = true;
      this.refreshPageView();
    }
    await dockerService.refreshOverview(mode);
    if (appState.currentPage === "docker") {
      dockerState.panelNeedsRefresh = true;
      this.syncSelection();
      this.refreshPageView();
    }
  }

  private addManaged(bucket: ManagedListener[], element: Element | null, event: string, handler: EventListener): void {
    if (!element) return;
    element.addEventListener(event, handler);
    bucket.push({ element, event, handler });
  }

  private removeManagedListeners(bucket: ManagedListener[]): void {
    for (const listener of bucket) listener.element.removeEventListener(listener.event, listener.handler);
    bucket.length = 0;
  }

  private startMemoryMonitoring(): void {
    if (!import.meta.env.DEV || this.memoryMonitorTimer !== null) return;
    this.memoryMonitorTimer = MemoryMonitor.getInstance().startMonitoring(10_000);
  }

  private requestPanelSectionUpdate(): void {
    if (this.panelUpdateRafId !== null) return;
    this.panelUpdateRafId = window.requestAnimationFrame(() => {
      this.panelUpdateRafId = null;
      this.updatePanelSection();
    });
  }

  private isDockerPanelTab(value: string): value is DockerPanelTab {
    return value === "containers" || value === "images" || value === "stats" || value === "compose";
  }

  private isDockerSelectionKind(value: string): value is DockerSelectionKind {
    return value === "container" || value === "image" || value === "stat" || value === "compose";
  }

  private isDockerActionType(value: string): value is DockerActionType {
    return getDockerActionMeta(value as DockerActionType) !== undefined;
  }

  private ensureVersionCheckLockHost(): HTMLElement {
    const existing = document.getElementById(DOCKER_VERSION_LOCK_ID);
    if (existing) {
      return existing;
    }

    const host = document.createElement("div");
    host.id = DOCKER_VERSION_LOCK_ID;
    host.className = "app-interaction-lock";
    host.innerHTML = `
      <div class="app-interaction-lock-panel" role="status" aria-live="polite">
        <span class="app-interaction-lock-spinner" aria-hidden="true"></span>
        <span class="app-interaction-lock-text" data-lock-message>正在检查版本源，请稍候...</span>
      </div>
    `;
    document.body.appendChild(host);
    return host;
  }

  private setVersionCheckLock(locked: boolean, message?: string): void {
    const host = this.ensureVersionCheckLockHost();
    const messageEl = host.querySelector<HTMLElement>("[data-lock-message]");
    if (messageEl && message) {
      messageEl.textContent = message;
    }
    host.classList.toggle("is-active", locked);
  }

  private getDefaultVersionSources(imageKey: string): VersionSourceConfig[] {
    const repository = imageKey.split(":")[0] || imageKey;
    return [
      {
        kind: "dockerHub",
        config: {
          namespace: "library",
          repository,
          includePrerelease: false,
        },
      },
      {
        kind: "localGit",
        config: {
          repoPath: ".",
          branch: "main",
        },
      },
    ];
  }

  private getConfiguredVersionSources(imageKey: string): VersionSourceConfig[] {
    const config = versionConfigStorage.getConfig(imageKey);
    if (config?.sources && config.sources.length > 0) {
      return config.sources;
    }
    return this.getDefaultVersionSources(imageKey);
  }

  private getConfiguredSourceKinds(imageKey: string): VersionSourceKind[] {
    const sources = this.getConfiguredVersionSources(imageKey);
    const kinds = sources.map((item) => item.kind);
    return kinds.length > 0 ? kinds : ["dockerHub", "localGit"];
  }

  private buildVersionSources(imageKey: string, kinds: VersionSourceKind[]): VersionSourceConfig[] {
    const repository = imageKey.split(":")[0] || imageKey;
    const repoParts = repository.split("/").filter((part) => part.length > 0);
    const owner = repoParts.length > 1 ? repoParts[0] : "final00000000";
    const repo = repoParts.length > 1 ? repoParts[repoParts.length - 1] : (repoParts[0] || repository);

    return kinds.map((kind) => {
      if (kind === "dockerHub") {
        return {
          kind: "dockerHub",
          config: {
            namespace: "library",
            repository,
            includePrerelease: false,
          },
        } as VersionSourceConfig;
      }

      if (kind === "githubRelease") {
        return {
          kind: "githubRelease",
          config: {
            owner,
            repo,
            includePrerelease: false,
          },
        } as VersionSourceConfig;
      }

      if (kind === "localGit") {
        return {
          kind: "localGit",
          config: {
            repoPath: ".",
            branch: "main",
          },
        } as VersionSourceConfig;
      }

      return {
        kind: "customApi",
        config: {
          endpoint: "https://example.com/version",
          method: "GET",
          headers: [],
          versionField: "version",
          notesField: "notes",
          publishedAtField: "publishedAt",
        },
      } as VersionSourceConfig;
    });
  }

  private openVersionSourceModal(imageKey: string): void {
    this.closeVersionSourceModal();

    const root = document.querySelector(".docker-page");
    if (!root) return;

    const html = renderSourceSelectionModalWithPreset(imageKey, this.getConfiguredSourceKinds(imageKey));
    root.insertAdjacentHTML("beforeend", html);

    // Use requestAnimationFrame to ensure DOM is ready before setting dataset
    requestAnimationFrame(() => {
      const modal = document.getElementById("version-source-modal");
      if (modal) {
        modal.dataset.imageKey = imageKey;

        // Add ESC key listener to close modal
        this.modalEscHandler = (e: KeyboardEvent) => {
          if (e.key === "Escape") {
            this.closeVersionSourceModal();
          }
        };
        document.addEventListener("keydown", this.modalEscHandler);

        // Focus first checkbox for better accessibility
        const firstCheckbox = modal.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (firstCheckbox) {
          firstCheckbox.focus();
        }
      }
    });
  }

  private closeVersionSourceModal(): void {
    const modal = document.getElementById("version-source-modal");
    if (modal) {
      modal.remove();
    }

    // Remove ESC key listener if it exists
    if (this.modalEscHandler) {
      document.removeEventListener("keydown", this.modalEscHandler);
      this.modalEscHandler = null;
    }
  }

  private isSourceConfigurationError(errorText: string): boolean {
    return /No valid source result|所有版本源检查失败|no valid source/i.test(errorText);
  }

  private formatVersionCheckError(errorText: string): string {
    if (this.isSourceConfigurationError(errorText)) {
      return "所有版本源检查失败。请点击“配置源”重新选择可用版本源后重试。";
    }
    return errorText || "未知错误";
  }

  private async handleVersionCheck(imageKey: string, overrideSources?: VersionSourceConfig[]): Promise<void> {
    let shouldOpenModal = false;

    try {
      this.setVersionCheckLock(true, "正在检查版本源，其他操作已临时锁定...");
      dockerVersionState.setChecking(imageKey, true);
      dockerState.panelNeedsRefresh = true;
      this.refreshPageView();
      showGlobalNotice("版本检查", "正在检查版本源，请稍候...", "info", 1200);

      const sources = overrideSources ?? this.getConfiguredVersionSources(imageKey);

      const response = await dockerVersionService.checkImageVersion(imageKey, sources);

      if (response.ok && response.data) {
        dockerVersionState.setCheckResult(imageKey, response.data);
        dockerState.panelNeedsRefresh = true;
        this.refreshPageView();
        if (response.data.hasUpdate) {
          showGlobalNotice("发现新版本", `镜像 ${imageKey} 有新版本可用`, "info", 3000);
        } else {
          showGlobalNotice("已是最新版本", `镜像 ${imageKey} 当前已是最新版本`, "success", 2000);
        }
      } else {
        const rawError = response.error || "未知错误";
        const errorMessage = this.formatVersionCheckError(rawError);
        showGlobalNotice("版本检查失败", errorMessage, "error");

        if (this.isSourceConfigurationError(rawError)) {
          const shouldReconfigure = window.confirm(
            "版本源检查全部失败。\n\n是否现在重新配置版本源并重试？"
          );
          if (shouldReconfigure) {
            shouldOpenModal = true;
          }
        }
      }
    } catch (error) {
      const rawError = String(error);
      const errorMessage = this.formatVersionCheckError(rawError);
      showGlobalNotice("版本检查失败", errorMessage, "error");
      if (this.isSourceConfigurationError(rawError)) {
        const shouldReconfigure = window.confirm(
          "版本源检查全部失败。\n\n是否现在重新配置版本源并重试？"
        );
        if (shouldReconfigure) {
          shouldOpenModal = true;
        }
      }
    } finally {
      dockerVersionState.setChecking(imageKey, false);
      dockerState.panelNeedsRefresh = true;

      // Open modal immediately if needed, before refreshPageView
      if (shouldOpenModal) {
        requestAnimationFrame(() => {
          this.openVersionSourceModal(imageKey);
        });
      }

      this.refreshPageView();
      this.setVersionCheckLock(false);
    }
  }

  private async handleVersionUpdate(imageKey: string, targetVersion: string, source: VersionSourceKind): Promise<void> {
    const confirmed = window.confirm(
      `确认更新镜像 ${imageKey} 到版本 ${targetVersion}？\n\n此操作将执行：\n1. 拉取最新代码 (git pull)\n2. 构建新镜像 (docker build)\n3. 备份旧容器 (backup)\n4. 启动新容器 (docker run)\n5. 健康检查 (health check)\n\n如果更新失败，将自动回滚到旧版本。`
    );

    if (!confirmed) {
      showGlobalNotice("已取消更新", "你取消了镜像更新操作", "info", 2000);
      return;
    }

    try {
      dockerVersionState.setUpdating(imageKey, true);
      dockerVersionState.clearProgressLogs(imageKey);
      this.refreshPageView();

      const response = await dockerVersionService.updateImageAndRestart(imageKey, targetVersion, source);

      if (response.ok && response.data) {
        response.data.stepLogs.forEach((log: UpdateStepLog) => {
          dockerVersionState.addProgressLog(imageKey, log);
        });

        if (response.data.success) {
          showGlobalNotice("更新成功", `镜像 ${imageKey} 已成功更新到 ${targetVersion}`, "success", 3000);
          await this.refreshOverviewWithUiSync("quick");
        } else {
          const errorMsg = response.data.stepLogs.find((log: UpdateStepLog) => !log.ok)?.error || "更新失败";
          if (response.data.rollback.attempted) {
            if (response.data.rollback.restored) {
              showGlobalNotice("更新失败，已回滚", `${errorMsg}\n已成功回滚到旧版本`, "info");
            } else {
              showGlobalNotice("更新失败，回滚失败", `${errorMsg}\n回滚失败: ${response.data.rollback.error}`, "error");
            }
          } else {
            showGlobalNotice("更新失败", errorMsg, "error");
          }
        }
      } else {
        showGlobalNotice("更新失败", response.error || "未知错误", "error");
      }
    } catch (error) {
      showGlobalNotice("更新异常", String(error), "error");
    } finally {
      dockerVersionState.setUpdating(imageKey, false);
      this.refreshPageView();
    }
  }

  cleanup(): void {
    this.removeManagedListeners(this.pageListeners);
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
    this.lastDeployFingerprint = null;

    // Clean up modal and ESC key handler
    this.closeVersionSourceModal();

    if (import.meta.env.DEV) MemoryMonitor.getInstance().logMemorySnapshot("DockerPage cleanup");
  }
}

export const dockerPage = new DockerPage();
