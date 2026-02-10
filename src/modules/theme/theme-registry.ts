import type { ColorThemeId, ThemeDefinition } from "./theme-types";

const DEFAULT_THEME: ColorThemeId = "github";

const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: "github",
    name: "GitHub 暗夜",
    desc: "舒适专业，适合长时间编码",
    preview: "linear-gradient(135deg, #58a6ff 0%, #1f6feb 100%)",
  },
  {
    id: "vercel",
    name: "Vercel 极简",
    desc: "纯黑背景，现代感十足",
    preview: "linear-gradient(135deg, #0070f3 0%, #0051cc 100%)",
  },
  {
    id: "linear",
    name: "Linear 现代",
    desc: "优雅简洁，灰紫色调",
    preview: "linear-gradient(135deg, #5e6ad2 0%, #4c5bc7 100%)",
  },
  {
    id: "arc",
    name: "Arc 渐变",
    desc: "精致品味，渐变和谐",
    preview: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  },
  {
    id: "notion",
    name: "Notion 温和",
    desc: "温和舒适，不易视觉疲劳",
    preview: "linear-gradient(135deg, #2383e2 0%, #1a6dcc 100%)",
  },
  {
    id: "white",
    name: "白昼简约",
    desc: "明亮清爽，适合白天办公与演示",
    preview: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
  },
];

const THEME_MAP = new Map<ColorThemeId, ThemeDefinition>(
  THEME_DEFINITIONS.map((theme) => [theme.id, theme])
);

export function isColorThemeId(value: string | null | undefined): value is ColorThemeId {
  return THEME_MAP.has(value as ColorThemeId);
}

export function getDefaultTheme(): ColorThemeId {
  return DEFAULT_THEME;
}

export function getThemeDefinitions(): readonly ThemeDefinition[] {
  return THEME_DEFINITIONS;
}

export function getThemeById(themeId: ColorThemeId): ThemeDefinition {
  const fallback = THEME_MAP.get(DEFAULT_THEME);
  const target = THEME_MAP.get(themeId);

  if (target) {
    return target;
  }

  if (!fallback) {
    throw new Error("主题定义缺失：github");
  }

  return fallback;
}
