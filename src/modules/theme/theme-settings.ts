import { escapeHtml } from "../../utils/formatters";
import { applyTheme, getEffectiveTheme } from "./theme-engine";
import { getThemeById, getThemeDefinitions, isColorThemeId } from "./theme-registry";
import { saveTheme } from "./theme-storage";
import type { ColorThemeId, ThemeDefinition } from "./theme-types";

const THEME_PANEL_SELECTOR = "[data-theme-panel]";
const THEME_GRID_SELECTOR = "[data-theme-grid]";
const THEME_OPTION_SELECTOR = ".theme-option";

function renderThemeOption(theme: ThemeDefinition, currentTheme: ColorThemeId): string {
  const active = theme.id === currentTheme;

  return `
    <button
      type="button"
      class="theme-option ${active ? "active" : ""}"
      data-theme="${escapeHtml(theme.id)}"
      aria-pressed="${active ? "true" : "false"}"
    >
      <div class="theme-preview" style="background: ${escapeHtml(theme.preview)};"></div>
      <div class="theme-header">
        <div class="theme-info">
          <div class="theme-name">${escapeHtml(theme.name)}</div>
          <div class="theme-desc">${escapeHtml(theme.desc)}</div>
        </div>
        <span class="theme-check" aria-hidden="true">✓</span>
      </div>
    </button>
  `;
}

function syncThemeSettingsUi(root: ParentNode, themeId: ColorThemeId): void {
  const options = root.querySelectorAll<HTMLElement>(THEME_OPTION_SELECTOR);

  options.forEach((option) => {
    const active = option.dataset.theme === themeId;
    option.classList.toggle("active", active);
    option.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const themeInfo = getThemeById(themeId);
  const nameEl = root.querySelector<HTMLElement>("[data-current-theme-name]");
  const descEl = root.querySelector<HTMLElement>("[data-current-theme-desc]");

  if (nameEl) {
    nameEl.textContent = themeInfo.name;
  }

  if (descEl) {
    descEl.textContent = themeInfo.desc;
  }
}

export function renderThemeSettingsPanel(): string {
  const currentTheme = getEffectiveTheme();
  const currentThemeInfo = getThemeById(currentTheme);
  const options = getThemeDefinitions().map((theme) => renderThemeOption(theme, currentTheme)).join("");

  return `
    <section class="card animate-fade-in" data-theme-panel>
      <h3 class="text-lg font-semibold text-text-primary mb-3">UI 主题</h3>
      <p class="text-sm text-text-secondary mb-3">切换后立即生效，自动记住你的选择。</p>

      <div class="theme-current" aria-live="polite">
        <div class="theme-current-label">当前主题</div>
        <div class="theme-current-name" data-current-theme-name>${escapeHtml(currentThemeInfo.name)}</div>
        <div class="theme-current-desc" data-current-theme-desc>${escapeHtml(currentThemeInfo.desc)}</div>
      </div>

      <div class="theme-grid" data-theme-grid>
        ${options}
      </div>
    </section>
  `;
}

export function bindThemeSettingsPanel(root: ParentNode = document): void {
  const panel = root.querySelector<HTMLElement>(THEME_PANEL_SELECTOR);
  if (!panel || panel.dataset.themeBound === "true") {
    return;
  }

  const grid = panel.querySelector<HTMLElement>(THEME_GRID_SELECTOR);
  if (!grid) {
    return;
  }

  grid.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLElement>(THEME_OPTION_SELECTOR);

    if (!option || !grid.contains(option)) {
      return;
    }

    const themeId = option.dataset.theme;
    if (!isColorThemeId(themeId)) {
      return;
    }

    applyTheme(themeId);
    saveTheme(themeId);
    syncThemeSettingsUi(panel, themeId);
  });

  panel.dataset.themeBound = "true";
}
