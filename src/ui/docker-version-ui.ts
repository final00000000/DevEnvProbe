import { escapeHtml } from "../utils/formatters";
import type {
  CheckImageVersionResponse,
  SourceCheckResult,
  VersionSourceKind,
} from "../types";

const SOURCE_LABELS: Record<VersionSourceKind, string> = {
  dockerHub: "Docker Hub",
  githubRelease: "GitHub Releases",
  localGit: "本地 Git",
  customApi: "自定义 API",
};

export function renderVersionManagementBlock(
  imageKey: string,
  checkResult: CheckImageVersionResponse | null,
  checking: boolean,
  updating: boolean,
  progressLogs?: any[]
): string {
  if (updating) {
    return renderUpdatingState(imageKey, progressLogs);
  }

  if (checking) {
    return renderCheckingState();
  }

  if (!checkResult) {
    return renderInitialState(imageKey);
  }

  if (checkResult.hasUpdate && checkResult.recommended) {
    return renderUpdateAvailable(imageKey, checkResult);
  }

  return renderUpToDate(imageKey, checkResult);
}

function renderInitialState(imageKey: string): string {
  return `
    <div class="docker-workbench-action-section pb-5 mb-5 border-b-2 border-primary/20">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span class="text-base font-bold text-text">镜像版本管理</span>
        </div>
        <span class="badge badge-secondary">未检查</span>
      </div>
      <div class="mt-2 p-5 rounded-xl bg-gradient-to-br from-surface-subtle to-surface border-2 border-border-subtle shadow-md hover:shadow-lg transition-all duration-200">
        <div class="flex items-start gap-3 mb-4">
          <div class="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-medium text-text mb-1">检查镜像版本</h4>
            <p class="text-xs text-text-muted leading-relaxed">检查此镜像是否有新版本可用，支持多个版本源并行查询</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn btn-primary btn-sm flex-1 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150 cursor-pointer"
            data-version-check="${escapeHtml(imageKey)}"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>检查更新</span>
          </button>
          <button
            class="btn btn-secondary btn-sm hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
            data-version-source-config="${escapeHtml(imageKey)}"
            title="配置版本检查源"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderCheckingState(): string {
  return `
    <div class="docker-workbench-action-section pb-5 mb-5 border-b-2 border-primary/30">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-primary animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-base font-bold text-text">镜像版本管理</span>
        </div>
        <span class="badge badge-info animate-pulse">检查中...</span>
      </div>
      <div class="mt-2 p-5 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20 shadow-md">
        <div class="flex items-center gap-3">
          <div class="flex-shrink-0">
            <div class="animate-spin rounded-full h-8 w-8 border-3 border-primary/30 border-t-primary"></div>
          </div>
          <div class="flex-1">
            <p class="text-sm font-medium text-text mb-1">正在检查版本...</p>
            <p class="text-xs text-text-muted">并行查询多个版本源，请稍候</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderUpdateAvailable(imageKey: string, result: CheckImageVersionResponse): string {
  const recommended = result.recommended!;
  const sourceLabel = SOURCE_LABELS[recommended.source];

  return `
    <div class="docker-workbench-action-section pb-5 mb-5 border-b-2 border-warning/30">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span class="text-base font-bold text-text">镜像版本管理</span>
        </div>
        <span class="badge badge-warning animate-pulse">有更新</span>
      </div>
      <div class="mt-2 p-5 rounded-xl bg-gradient-to-br from-warning/5 to-warning/10 border-2 border-warning/30 shadow-md hover:shadow-lg transition-all duration-200">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span class="text-xs font-medium text-text-muted">源: ${escapeHtml(sourceLabel)}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="btn btn-secondary btn-xs hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
              data-version-source-config="${escapeHtml(imageKey)}"
              title="配置版本源"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              class="btn btn-secondary btn-xs hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
              data-version-check="${escapeHtml(imageKey)}"
              title="重新检查"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <div class="mt-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <div class="flex items-start gap-3 mb-3">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-warning/20 flex items-center justify-center">
              <svg class="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div class="flex-1">
              <h4 class="text-sm font-semibold text-warning mb-2">发现新版本</h4>
              <div class="text-xs space-y-1.5">
                ${result.currentVersion ? `<div class="flex items-center gap-2"><span class="text-text-muted">当前:</span><code class="px-2 py-0.5 rounded bg-surface text-text font-mono">${escapeHtml(result.currentVersion)}</code></div>` : ""}
                <div class="flex items-center gap-2"><span class="text-text-muted">最新:</span><code class="px-2 py-0.5 rounded bg-warning/20 text-warning font-mono font-semibold">${escapeHtml(recommended.version)}</code></div>
                ${recommended.releaseNotes ? `<p class="text-text-muted mt-2 leading-relaxed">${escapeHtml(recommended.releaseNotes.substring(0, 120))}${recommended.releaseNotes.length > 120 ? "..." : ""}</p>` : ""}
              </div>
            </div>
          </div>
          <button
            class="btn btn-warning btn-sm w-full flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150 cursor-pointer shadow-sm hover:shadow-md"
            data-version-update="${escapeHtml(imageKey)}"
            data-version-target="${escapeHtml(recommended.version)}"
            data-version-source="${escapeHtml(recommended.source)}"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>立即更新并重启</span>
          </button>
        </div>

        ${renderSourceResults(result.results)}
      </div>
    </div>
  `;
}

function renderUpToDate(imageKey: string, result: CheckImageVersionResponse): string {
  return `
    <div class="docker-workbench-action-section pb-5 mb-5 border-b-2 border-success/30">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-base font-bold text-text">镜像版本管理</span>
        </div>
        <span class="badge badge-success">已是最新</span>
      </div>
      <div class="mt-2 p-5 rounded-xl bg-gradient-to-br from-success/5 to-success/10 border-2 border-success/30 shadow-md hover:shadow-lg transition-all duration-200">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-text-muted">最后检查: ${formatTimestamp(result.checkedAtMs)}</span>
          <div class="flex items-center gap-2">
            <button
              class="btn btn-secondary btn-xs hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
              data-version-source-config="${escapeHtml(imageKey)}"
              title="配置版本源"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              class="btn btn-secondary btn-xs hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
              data-version-check="${escapeHtml(imageKey)}"
              title="重新检查"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <div class="mt-3 p-3 rounded-lg bg-success/10 border border-success/30">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center">
              <svg class="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div class="flex-1">
              <h4 class="text-sm font-semibold text-success mb-1">当前已是最新版本</h4>
              ${result.currentVersion ? `<div class="text-xs text-text-muted">版本: <code class="px-2 py-0.5 rounded bg-surface text-text font-mono">${escapeHtml(result.currentVersion)}</code></div>` : ""}
            </div>
          </div>
        </div>

        ${renderSourceResults(result.results)}
      </div>
    </div>
  `;
}

function renderUpdatingState(_imageKey: string, progressLogs?: any[]): string {
  const logsHtml = progressLogs && progressLogs.length > 0
    ? progressLogs.map(log => renderProgressStep(
        log.step,
        log.ok ? "success" : (log.skipped ? "pending" : "error"),
        log.error || (log.ok ? `${log.elapsedMs}ms` : undefined)
      )).join("")
    : '<div class="flex items-center gap-2 text-xs text-text-muted"><div class="animate-spin rounded-full h-3 w-3 border-2 border-primary/30 border-t-primary"></div><span>等待更新开始...</span></div>';

  return `
    <div class="docker-workbench-action-section pb-5 mb-5 border-b-2 border-primary/30">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-primary animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span class="text-base font-bold text-text">镜像版本管理</span>
        </div>
        <span class="badge badge-info animate-pulse">更新中...</span>
      </div>
      <div class="mt-2 p-5 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/30 shadow-md">
        <div class="flex items-start gap-3 mb-4">
          <div class="flex-shrink-0">
            <div class="animate-spin rounded-full h-8 w-8 border-3 border-primary/30 border-t-primary"></div>
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-semibold text-text mb-1">正在更新镜像...</h4>
            <p class="text-xs text-text-muted">执行 git pull → docker build → 容器备份 → docker run → 健康检查</p>
          </div>
        </div>
        <div id="version-update-progress" class="space-y-2 mt-4">
          ${logsHtml}
        </div>
      </div>
    </div>
  `;
}

export function renderProgressStep(step: string, status: "pending" | "running" | "success" | "error", message?: string): string {
  const icons = {
    pending: '<div class="w-4 h-4 rounded-full border-2 border-text-muted"></div>',
    running: '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>',
    success: '<svg class="w-4 h-4 text-success" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>',
    error: '<svg class="w-4 h-4 text-error" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>',
  };

  const stepLabels: Record<string, string> = {
    git_pull: "拉取代码",
    docker_build: "构建镜像",
    backup_container: "备份容器",
    docker_run: "启动容器",
    health_check: "健康检查",
  };

  return `
    <div class="flex items-center gap-2 p-2 rounded ${status === "error" ? "bg-error/5" : ""}">
      ${icons[status]}
      <span class="${status === "error" ? "text-error" : ""}">${stepLabels[step] || step}</span>
      ${message ? `<span class="text-text-muted ml-auto text-xs">${escapeHtml(message)}</span>` : ""}
    </div>
  `;
}

function renderSourceResults(results: SourceCheckResult[]): string {
  if (results.length === 0) return "";

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;

  return `
    <details class="mt-2">
      <summary class="text-xs text-text-muted cursor-pointer hover:text-text">
        检查详情 (${successCount} 成功, ${failCount} 失败)
      </summary>
      <div class="mt-2 space-y-1">
        ${results.map((r) => renderSourceResult(r)).join("")}
      </div>
    </details>
  `;
}

function renderSourceResult(result: SourceCheckResult): string {
  const sourceLabel = SOURCE_LABELS[result.source];
  const statusIcon = result.ok
    ? '<svg class="w-3 h-3 text-success" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>'
    : '<svg class="w-3 h-3 text-error" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>';

  return `
    <div class="flex items-start gap-2 text-xs p-2 rounded bg-surface">
      ${statusIcon}
      <div class="flex-1">
        <div class="font-medium">${escapeHtml(sourceLabel)}</div>
        ${result.ok && result.latest ? `<div class="text-text-muted">版本: ${escapeHtml(result.latest.version)}</div>` : ""}
        ${!result.ok && result.errorMessage ? `<div class="text-error">${escapeHtml(result.errorMessage)}</div>` : ""}
        <div class="text-text-muted">${result.elapsedMs}ms</div>
      </div>
    </div>
  `;
}

function formatTimestamp(ms: number): string {
  const now = Date.now();
  const diff = now - ms;

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

export function renderSourceSelectionModal(_imageKey: string): string {
  return renderSourceSelectionModalWithSelected(_imageKey, ["dockerHub", "localGit"]);
}

function renderSourceSelectionModalWithSelected(
  _imageKey: string,
  selectedSources: VersionSourceKind[]
): string {
  const isChecked = (source: VersionSourceKind): string => selectedSources.includes(source) ? "checked" : "";

  return `
    <div class="modal-overlay" id="version-source-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
      <div class="modal-content max-w-2xl animate-fade-in">
        <div class="modal-header border-b pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center" aria-hidden="true">
              <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div class="flex-1">
              <h3 id="modal-title" class="text-lg font-semibold text-text">配置版本检查源</h3>
              <p id="modal-description" class="text-xs text-text-muted mt-0.5">选择一个或多个版本源进行并行检查</p>
            </div>
          </div>
          <button class="modal-close hover:bg-surface-hover active:bg-surface-active rounded-lg p-1.5 transition-colors duration-150 cursor-pointer" data-modal-close aria-label="关闭对话框">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body py-6">
          <div class="space-y-3">
            <label class="flex items-start gap-3 p-4 rounded-xl border-2 border-border-subtle cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group">
              <input type="checkbox" name="version-source" value="dockerHub" class="mt-1.5 w-4 h-4 text-primary rounded border-border focus:ring-2 focus:ring-primary/20 cursor-pointer" ${isChecked("dockerHub")} />
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <svg class="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338 0-.676.03-1.01.09-1.04-2.53-3.483-4.17-6.53-4.17l-.291.001c-.146.005-.29.01-.434.017-.18-.155-.34-.29-.51-.41-1.04-.737-2.22-1.14-3.44-1.14-1.39 0-2.64.62-3.64 1.82-.943 1.14-1.36 2.61-1.22 4.28.02.17.05.35.08.52C3.3 10.42 1.66 11.18 1.54 11.24c-.03.02-.04.03-.07.05-.09.08-.14.2-.14.33v.17c0 .05.01.09.02.13.7 5.05 4.65 8.93 9.77 9.64 1.16.16 2.33.24 3.5.24 5.46 0 10.36-2.85 12.23-7.12.01-.03.03-.05.04-.08.36-.8.55-1.64.55-2.5 0-1.7-.7-3.3-1.88-4.43zM.002 11.576l-.002-.04.002.04z"/>
                  </svg>
                  <span class="font-semibold text-text group-hover:text-primary transition-colors">Docker Hub</span>
                </div>
                <p class="text-xs text-text-muted leading-relaxed">检查 Docker Hub 上的远程镜像标签，支持官方和第三方镜像</p>
              </div>
            </label>

            <label class="flex items-start gap-3 p-4 rounded-xl border-2 border-border-subtle cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group">
              <input type="checkbox" name="version-source" value="githubRelease" class="mt-1.5 w-4 h-4 text-primary rounded border-border focus:ring-2 focus:ring-primary/20 cursor-pointer" ${isChecked("githubRelease")} />
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <svg class="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <span class="font-semibold text-text group-hover:text-primary transition-colors">GitHub Releases</span>
                </div>
                <p class="text-xs text-text-muted leading-relaxed">检查项目的 GitHub Release 版本，适用于开源项目</p>
              </div>
            </label>

            <label class="flex items-start gap-3 p-4 rounded-xl border-2 border-border-subtle cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group">
              <input type="checkbox" name="version-source" value="localGit" class="mt-1.5 w-4 h-4 text-primary rounded border-border focus:ring-2 focus:ring-primary/20 cursor-pointer" ${isChecked("localGit")} />
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span class="font-semibold text-text group-hover:text-primary transition-colors">本地 Git 仓库</span>
                </div>
                <p class="text-xs text-text-muted leading-relaxed">检查本地 Git 仓库是否有远程更新，适用于自托管项目</p>
              </div>
            </label>

            <label class="flex items-start gap-3 p-4 rounded-xl border-2 border-border-subtle cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group">
              <input type="checkbox" name="version-source" value="customApi" class="mt-1.5 w-4 h-4 text-primary rounded border-border focus:ring-2 focus:ring-primary/20 cursor-pointer" ${isChecked("customApi")} />
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span class="font-semibold text-text group-hover:text-primary transition-colors">自定义 API</span>
                </div>
                <p class="text-xs text-text-muted leading-relaxed">调用自定义的版本检查接口，支持企业内部版本管理系统</p>
              </div>
            </label>
          </div>

          <div class="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div class="flex items-start gap-2">
              <svg class="w-4 h-4 text-primary mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p class="text-xs text-text-muted leading-relaxed">建议至少保留一个可访问的版本源，系统将并行查询所有选中的源并推荐最佳版本。</p>
            </div>
          </div>
        </div>
        <div class="modal-footer border-t pt-4">
          <button
            class="btn btn-secondary hover:bg-surface-hover active:bg-surface-active transition-colors duration-150 cursor-pointer"
            data-modal-close
            type="button"
            aria-label="取消配置">
            取消
          </button>
          <button
            class="btn btn-primary flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150 cursor-pointer shadow-sm hover:shadow-md"
            data-version-check-confirm
            type="button"
            aria-label="确认配置并开始检查版本">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>确认并开始检查</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderSourceSelectionModalWithPreset(
  imageKey: string,
  selectedSources: VersionSourceKind[]
): string {
  return renderSourceSelectionModalWithSelected(imageKey, selectedSources);
}

export function renderUpdateConfirmModal(
  imageKey: string,
  currentVersion: string | undefined,
  targetVersion: string,
  source: VersionSourceKind
): string {
  const sourceLabel = SOURCE_LABELS[source];

  return `
    <div class="modal-overlay" id="version-update-modal" role="dialog" aria-modal="true">
      <div class="modal-content max-w-lg">
        <div class="modal-header">
          <h3 class="text-lg font-semibold">确认更新</h3>
          <button class="modal-close" data-modal-close>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="p-4 rounded-lg bg-warning/10 border border-warning/20 mb-4">
            <div class="flex items-start gap-2">
              <svg class="w-5 h-5 text-warning mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div class="flex-1 text-sm">
                <div class="font-medium mb-1">此操作将执行以下步骤：</div>
                <ol class="list-decimal list-inside space-y-1 text-text-muted">
                  <li>拉取最新代码（git pull）</li>
                  <li>构建新镜像（docker build）</li>
                  <li>停止旧容器（docker stop）</li>
                  <li>启动新容器（docker run）</li>
                </ol>
                <div class="mt-2 text-warning">如果更新失败，将自动回滚到旧版本。</div>
              </div>
            </div>
          </div>

          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-text-muted">镜像:</span>
              <code class="text-xs">${escapeHtml(imageKey)}</code>
            </div>
            ${currentVersion ? `
            <div class="flex justify-between">
              <span class="text-text-muted">当前版本:</span>
              <code class="text-xs">${escapeHtml(currentVersion)}</code>
            </div>
            ` : ""}
            <div class="flex justify-between">
              <span class="text-text-muted">目标版本:</span>
              <code class="text-xs">${escapeHtml(targetVersion)}</code>
            </div>
            <div class="flex justify-between">
              <span class="text-text-muted">版本源:</span>
              <span>${escapeHtml(sourceLabel)}</span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-modal-close>取消</button>
          <button
            class="btn btn-warning"
            data-version-update-confirm="${escapeHtml(imageKey)}"
            data-version-target="${escapeHtml(targetVersion)}"
            data-version-source="${escapeHtml(source)}"
          >
            确认更新
          </button>
        </div>
      </div>
    </div>
  `;
}
