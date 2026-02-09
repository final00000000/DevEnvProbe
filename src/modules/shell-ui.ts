import { escapeHtml } from "../utils/formatters";

interface LoadingOptions {
  loadingId?: string;
  hint?: string;
}

export function getSettingsContent(): string {
  return `
    <div class="space-y-4">
      <div class="card animate-fade-in">
        <h3 class="text-lg font-semibold text-text-primary mb-4">显示与主题</h3>
        <div class="space-y-3 text-sm text-text-secondary">
          <p>已支持深色 / 浅色模式切换，并自动记住上次选择。</p>
          <p>字体已优化为中文友好字体栈，修复中文信息偶发乱码显示问题。</p>
          <p>命令执行统一后台静默，无额外 shell 弹窗。</p>
        </div>
      </div>

      <div class="card animate-fade-in">
        <h3 class="text-lg font-semibold text-text-primary mb-4">安装偏好</h3>
        <div class="space-y-2 text-sm text-text-secondary">
          <p>环境市场安装默认使用 winget。</p>
          <p>支持手动输入或点击“选择目录”挑选安装路径。</p>
          <p>安装路径示例：<span class="text-text-primary">D:/DevTools</span></p>
        </div>
      </div>
    </div>
  `;
}

export function bindSettingsActions(): void {
  // 当前设置页暂无交互控件，保留扩展点
}

function persistTheme(theme: "light" | "dark"): void {
  localStorage.setItem("dev-env-probe-theme", theme);
}

function syncThemeButton(): void {
  const isLight = document.documentElement.classList.contains("light");
  const iconDark = document.getElementById("theme-icon-dark");
  const iconLight = document.getElementById("theme-icon-light");
  const text = document.getElementById("theme-text");

  if (isLight) {
    iconDark?.classList.add("hidden");
    iconLight?.classList.remove("hidden");
    if (text) {
      text.textContent = "深色模式";
    }
  } else {
    iconDark?.classList.remove("hidden");
    iconLight?.classList.add("hidden");
    if (text) {
      text.textContent = "浅色模式";
    }
  }
}

export function initThemeToggle(): void {
  const toggleBtn = document.getElementById("theme-toggle");
  toggleBtn?.addEventListener("click", () => {
    const html = document.documentElement;
    const willLight = !html.classList.contains("light");
    html.classList.toggle("light", willLight);
    persistTheme(willLight ? "light" : "dark");
    syncThemeButton();
  });
  syncThemeButton();
}

export function loadThemePreference(): void {
  const saved = localStorage.getItem("dev-env-probe-theme");
  if (saved === "light") {
    document.documentElement.classList.add("light");
  }
  syncThemeButton();
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
