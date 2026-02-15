/**
 * Docker 资源图表 — 类型定义
 */

/** 排序维度 */
export type ChartSortBy = "cpu" | "mem" | "net";

/** 显示数量 */
export type ChartTopN = 3 | 5 | 10;

/** 排序维度配置 */
export interface ChartSortOption {
  readonly key: ChartSortBy;
  readonly label: string;
  readonly hint: string;
}

/** 所有可选排序维度（顺序即 UI 顺序） */
export const CHART_SORT_OPTIONS: readonly ChartSortOption[] = [
  { key: "cpu", label: "CPU", hint: "处理器" },
  { key: "mem", label: "MEM", hint: "内存" },
  { key: "net", label: "NET", hint: "网络" },
] as const;

/** 所有可选 TopN 值 */
export const CHART_TOP_N_OPTIONS: readonly ChartTopN[] = [3, 5, 10] as const;

/** 颜色等级阈值 */
export const CHART_COLOR_THRESHOLDS = {
  ok: 60,
  warn: 85,
} as const;
