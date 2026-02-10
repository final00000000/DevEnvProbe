import { appState, deployState, dockerState } from "../state";
import { deployService, dockerService } from "../services";
import { getDockerEmptyState, getDockerLoadingState, getDockerPanelSkeleton, getDockerSummarySkeletonCards, getMetricCard } from "../ui";
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
} from "../modules/docker-workbench";
import {
  DeployOrchestrator,
  renderDeployPipelineCard,
  resolveGitProjectPath,
  validateProfileForExecution,
} from "../modules/deploy";
import { isContainerRunning } from "../modules/docker-data";
import { debounce } from "../utils/debounce";
import { escapeHtml, formatPercent, getBadgeClassByUsage } from "../utils/formatters";
import { MemoryMonitor } from "../utils/memory-monitor";
import { DOCKER_INIT_DELAY_MS, DOCKER_SEARCH_DEBOUNCE_MS } from "../constants/config";
import { showGlobalNotice } from "../modules/shell-ui";
import type { DeployProfile, DockerActionType, DockerPanelTab, DockerSelectionKind } from "../types";
import type { DockerOverviewMode } from "../services/docker-service";

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

export class DockerPage {
  private summaryCardsCache: string | null = null;
  private lastSummaryFingerprint: string | null = null;
  private lastDeployFingerprint: string | null = null;
  private pageListeners: ManagedListener[] = [];
  private memoryMonitorTimer: number | null = null;
  private panelUpdateRafId: number | null = null;
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
                <button class="docker-tab ${dockerState.activeTab === "containers" ? "active" : ""}" data-docker-tab="containers">容器</button>
                <button class="docker-tab ${dockerState.activeTab === "images" ? "active" : ""}" data-docker-tab="images">镜像</button>
                <button class="docker-tab ${dockerState.activeTab === "stats" ? "active" : ""}" data-docker-tab="stats">资源监控</button>
                <button class="docker-tab ${dockerState.activeTab === "compose" ? "active" : ""}" data-docker-tab="compose">Compose</button>
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

  private async runDeployPipeline(): Promise<void> {
    if (deployState.pipeline.running) {
      return;
    }

    const profile = deployState.activeProfile;
    if (!profile) {
      showGlobalNotice("无法执行部署", "当前没有可用部署配置。", "error");
      return;
    }

    if (profile.git.enabled && (deployState.availableBranches.length === 0 || deployState.selectedBranch.trim().length === 0)) {
      await this.refreshDeployBranches();
      if (deployState.availableBranches.length === 0) {
        return;
      }
    }

    const selectedBranch = deployState.selectedBranch.trim();

    const validationError = validateProfileForExecution(profile, selectedBranch);
    if (validationError) {
      showGlobalNotice("部署参数不完整", validationError, "error");
      return;
    }

    if (!this.confirmDeployPipelineRisk(profile, selectedBranch)) {
      return;
    }

    const nextState = await this.deployOrchestrator.run(
      profile,
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

    const deployModeText = profile.mode === "run" ? "Run 容器重建" : "Compose 服务更新";
    const branchText = profile.git.enabled && selectedBranch.length > 0 ? `，分支 ${selectedBranch}` : "";
    showGlobalNotice("部署完成", `${profile.name} 已完成${deployModeText}${branchText}。`, "success");
    await this.refreshOverviewWithUiSync("quick");
  }

  private confirmDeployPipelineRisk(profile: DeployProfile, selectedBranch: string): boolean {
    if (profile.mode !== "run") {
      return true;
    }

    const lines: string[] = [
      "⚠️ 即将执行一键自动部署（Run 模式）",
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

    return `
      <div class="docker-workbench-detail-card">
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

        if (action === "run-pipeline") {
          await this.runDeployPipeline();
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
    if (import.meta.env.DEV) MemoryMonitor.getInstance().logMemorySnapshot("DockerPage cleanup");
  }
}

export const dockerPage = new DockerPage();
