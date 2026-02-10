import type { ColorThemeId } from "./theme-types";
import { getDefaultTheme, isColorThemeId } from "./theme-registry";

export const COLOR_THEME_STORAGE_KEY = "dev-env-probe-color-theme";
export const LEGACY_THEME_STORAGE_KEY = "dev-env-probe-theme";

export function saveTheme(themeId: ColorThemeId): void {
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, themeId);
}

export function loadPersistedTheme(): ColorThemeId {
  const savedTheme = localStorage.getItem(COLOR_THEME_STORAGE_KEY);

  if (isColorThemeId(savedTheme)) {
    return savedTheme;
  }

  return getDefaultTheme();
}

export function migrateLegacyThemeState(): void {
  document.documentElement.classList.remove("light");

  if (localStorage.getItem(LEGACY_THEME_STORAGE_KEY) !== null) {
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  }
}
