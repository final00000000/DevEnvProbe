export const COLOR_THEME_IDS = ["github", "vercel", "linear", "arc", "notion", "white"] as const;

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export interface ThemeDefinition {
  id: ColorThemeId;
  name: string;
  desc: string;
  preview: string;
}

export interface ThemeApplyResult {
  previousTheme: ColorThemeId;
  nextTheme: ColorThemeId;
  changed: boolean;
}
