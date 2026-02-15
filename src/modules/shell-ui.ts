import { escapeHtml } from "../utils/formatters";
import { renderThemeSettingsPanel } from "./theme/theme-settings";

interface LoadingOptions {
  loadingId?: string;
  hint?: string;
}

function getDockerPathConfig() {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes('mac') || userAgent.includes('mac')) {
    return {
      placeholder: '/Applications/Docker.app',
      hint: '指定 Docker Desktop 应用程序的路径'
    };
  } else if (platform.includes('linux') || userAgent.includes('linux')) {
    return {
      placeholder: '/usr/bin/docker',
      hint: '指定 Docker 命令行工具的路径'
    };
  } else {
    return {
      placeholder: 'C:/Program Files/Docker/Docker/Docker Desktop.exe',
      hint: '指定 Docker Desktop 可执行文件的完整路径'
    };
  }
}

export function getSettingsContent(): string {
  const dockerConfig = getDockerPathConfig();

  return `
    <div class="settings-container">
      <!-- 主题设置区域 -->
      <div class="settings-section">
        ${renderThemeSettingsPanel()}
      </div>

      <!-- 配置设置网格 -->
      <div class="settings-grid">
        <!-- Docker 设置卡片 -->
        <div class="card settings-card animate-fade-in">
          <div class="settings-card-header">
            <div class="settings-icon-wrapper">
              <svg class="settings-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div class="settings-header-text">
              <h3 class="settings-card-title">Docker 配置</h3>
              <p class="settings-card-subtitle">容器运行时环境设置</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="settings-field">
              <label for="docker-path-input" class="settings-label">
                <svg class="settings-label-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span>Docker Desktop 路径</span>
              </label>
              <input
                type="text"
                id="docker-path-input"
                class="settings-input"
                placeholder="${escapeHtml(dockerConfig.placeholder)}"
              >
              <p class="settings-hint">${escapeHtml(dockerConfig.hint)}</p>
            </div>

            <div class="settings-field">
              <label for="docker-config-select" class="settings-label">
                <svg class="settings-label-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>默认容器配置</span>
              </label>
              <select id="docker-config-select" class="settings-select">
                <option value="default">默认配置</option>
                <option value="performance">性能优先</option>
                <option value="memory">内存优先</option>
              </select>
              <p class="settings-hint">选择容器启动时的默认资源配置策略</p>
            </div>
          </div>
        </div>

        <!-- 环境市场设置卡片 -->
        <div class="card settings-card animate-fade-in">
          <div class="settings-card-header">
            <div class="settings-icon-wrapper">
              <svg class="settings-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <div class="settings-header-text">
              <h3 class="settings-card-title">环境市场</h3>
              <p class="settings-card-subtitle">开发工具安装配置</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="settings-field">
              <label for="package-manager-select" class="settings-label">
                <svg class="settings-label-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span>包管理器</span>
              </label>
              <select id="package-manager-select" class="settings-select">
                <option value="winget">Winget (推荐)</option>
                <option value="chocolatey">Chocolatey</option>
                <option value="scoop">Scoop</option>
              </select>
              <p class="settings-hint">选择用于安装开发工具的包管理器</p>
            </div>

            <div class="settings-field">
              <label for="default-install-path-input" class="settings-label">
                <svg class="settings-label-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span>默认安装路径</span>
              </label>
              <div class="settings-input-with-action">
                <input
                  type="text"
                  id="default-install-path-input"
                  class="settings-input"
                  placeholder="D:/DevTools"
                >
                <button
                  type="button"
                  id="pick-default-install-path-btn"
                  class="btn btn-secondary settings-input-action-btn"
                  aria-label="选择默认安装路径目录"
                >
                  选择目录
                </button>
              </div>
              <p class="settings-hint">默认路径用于全局安装，环境市场输入框可在当次安装临时覆盖</p>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-about-section">
        <div class="card settings-info-card animate-fade-in">
          <div class="settings-info-header">
            <svg class="settings-info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="settings-info-title">关于</h3>
          </div>

          <div class="settings-info-content">
            <div class="settings-about-version">
              <span class="settings-about-label">应用版本</span>
              <span class="settings-about-value">v0.1.0</span>
            </div>

            <a
              href="https://github.com/final00000000/DevEnvProbe"
              id="settings-github-link"
              class="settings-github-link"
              title="访问项目仓库"
              aria-label="访问 GitHub 项目仓库"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
              </svg>
              <span>GitHub 仓库</span>
            </a>

            <button
              type="button"
              id="check-update-btn"
              class="btn btn-primary settings-update-btn"
            >
              检查更新
            </button>
            <p id="update-status" class="settings-update-hint hidden" aria-live="polite"></p>
          </div>
        </div>
      </div>

    </div>
  `;
}

export function initRefreshButton(onRefresh: () => Promise<void>): void {
  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn?.addEventListener("click", async () => {
    await onRefresh();
    const icon = refreshBtn.querySelector("svg");
    if (icon) {
      icon.style.animation = "spin 0.5s linear";
      setTimeout(() => {
        icon.style.animation = "";
      }, 500);
    }
  });
}

export function showLoading(container: HTMLElement, message: string, options: LoadingOptions = {}): void {
  const loadingId = options.loadingId ?? "app-loading-panel";
  const hint = options.hint ?? "";
  const existing = container.querySelector<HTMLElement>(`#${loadingId}`);

  if (existing) {
    const textEl = existing.querySelector<HTMLElement>("[data-loading-text]");
    const hintEl = existing.querySelector<HTMLElement>("[data-loading-hint]");
    if (textEl) {
      textEl.textContent = message;
    }
    if (hintEl) {
      hintEl.textContent = hint;
      hintEl.classList.toggle("hidden", hint.length === 0);
    }
    return;
  }

  container.innerHTML = `
    <div id="${escapeHtml(loadingId)}" class="card animate-fade-in app-loading-state" role="status" aria-live="polite">
      <div class="app-loading-spinner" aria-hidden="true"></div>
      <p class="app-loading-text text-text-secondary" data-loading-text>${escapeHtml(message)}</p>
      <p class="app-loading-hint text-text-muted ${hint.length === 0 ? "hidden" : ""}" data-loading-hint>${escapeHtml(hint)}</p>
    </div>
  `;
}

export function getErrorBlock(title: string, detail: string): string {
  return `
    <div class="card animate-fade-in">
      <h3 class="text-lg font-semibold text-error mb-2">${escapeHtml(title)}</h3>
      <p class="text-sm text-text-secondary whitespace-pre-wrap">${escapeHtml(detail)}</p>
    </div>
  `;
}

export function ensureShellRuntimeStyles(): void {
  if (document.getElementById("runtime-spin-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "runtime-spin-style";
  style.textContent = `
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
`;
  document.head.appendChild(style);
}

type NoticeLevel = "info" | "success" | "error";

let noticeTimer: number | null = null;

function ensureGlobalNoticeHost(): HTMLElement {
  const existing = document.getElementById("global-notice-host");
  if (existing) {
    return existing;
  }

  const host = document.createElement("div");
  host.id = "global-notice-host";
  host.className = "global-notice-host";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-atomic", "true");
  document.body.appendChild(host);
  return host;
}

export function showGlobalNotice(
  title: string,
  detail: string,
  level: NoticeLevel = "info",
  durationMs = 4200
): void {
  const host = ensureGlobalNoticeHost();
  host.innerHTML = `
    <div class="global-notice is-${escapeHtml(level)}" role="alert">
      <div class="global-notice-content">
        <div class="global-notice-title">${escapeHtml(title)}</div>
        <div class="global-notice-detail">${escapeHtml(detail)}</div>
      </div>
      <button type="button" class="global-notice-close" aria-label="关闭提示">×</button>
    </div>
  `;

  const closeBtn = host.querySelector<HTMLButtonElement>(".global-notice-close");
  closeBtn?.addEventListener("click", () => {
    host.innerHTML = "";
    if (noticeTimer !== null) {
      window.clearTimeout(noticeTimer);
      noticeTimer = null;
    }
  });

  if (noticeTimer !== null) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  noticeTimer = window.setTimeout(() => {
    host.innerHTML = "";
    noticeTimer = null;
  }, durationMs);
}
