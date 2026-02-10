import { escapeHtml } from "../utils/formatters";
import { renderThemeSettingsPanel } from "./theme/theme-settings";

interface LoadingOptions {
  loadingId?: string;
  hint?: string;
}

export function getSettingsContent(): string {
  return `
    <div class="space-y-4">
      ${renderThemeSettingsPanel()}

      <div class="card animate-fade-in">
        <h3 class="text-lg font-semibold text-text-primary mb-4">主题说明</h3>
        <div class="space-y-3 text-sm text-text-secondary">
          <p>主题切换统一在此页面完成，不再区分深色 / 浅色模式。</p>
          <p>当前内置 GitHub、Vercel、Linear、Arc、Notion、白昼简约 六套主题。</p>
          <p>字体已优化为中文友好字体栈，修复中文信息偶发乱码显示问题。</p>
          <p>命令执行统一后台静默，无额外 shell 弹窗。</p>
        </div>
      </div>

      <div class="card animate-fade-in">
        <h3 class="text-lg font-semibold text-text-primary mb-4">安装偏好</h3>
        <div class="space-y-2 text-sm text-text-secondary">
          <p>环境市场安装默认使用 winget。</p>
          <p>支持手动输入或点击"选择目录"挑选安装路径。</p>
          <p>安装路径示例：<span class="text-text-primary">D:/DevTools</span></p>
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
