import type { ColorThemeId, ThemeApplyResult } from "./theme-types";
import { getDefaultTheme, isColorThemeId } from "./theme-registry";

const THEME_ATTRIBUTE = "data-theme";

export function getEffectiveTheme(): ColorThemeId {
  const rawTheme = document.documentElement.getAttribute(THEME_ATTRIBUTE);

  if (isColorThemeId(rawTheme)) {
    return rawTheme;
  }

  return getDefaultTheme();
}

export function applyTheme(themeId: ColorThemeId): ThemeApplyResult {
  const html = document.documentElement;
  const previousTheme = getEffectiveTheme();
  const defaultTheme = getDefaultTheme();

  html.classList.remove("light");

  if (themeId === defaultTheme) {
    html.removeAttribute(THEME_ATTRIBUTE);
  } else {
    html.setAttribute(THEME_ATTRIBUTE, themeId);
  }

  const nextTheme = getEffectiveTheme();

  return {
    previousTheme,
    nextTheme,
    changed: previousTheme !== nextTheme,
  };
}
