import type { ToolStatus, ToolFilterState } from "../types";

/**
 * Tools 页面状态管理
 */
export class ToolsState {
  /** 工具数据缓存 */
  dataCache: ToolStatus[] = [];

  /** 工具分类列表 */
  categories: string[] = [];

  /** 工具筛选状态 */
  filters: ToolFilterState = {
    search: "",
    status: "all",
    category: "all",
  };

  /** 安装路径 */
  installPath = "";

  /** 正在安装的工具 Key */
  installingKey: string | null = null;

  /** 安装日志 */
  installLog = "等待安装任务...";

  /** 安装状态文本 */
  installState = "";

  /** 最后扫描时间戳（ms） */
  lastScanAt = 0;

  /** 最后扫描耗时（ms） */
  lastScanElapsedMs = 0;

  /** 与上次对比：新增安装数 */
  diffInstalled = 0;

  /** 与上次对比：减少安装数 */
  diffMissing = 0;

  /** 工具刷新中标志 */
  refreshing = false;

  /** 工具网格渲染令牌（用于取消过期渲染） */
  gridRenderToken = 0;

  /** 工具搜索防抖定时器 */
  searchDebounceTimer: number | null = null;

  /** 工具自动刷新定时器 */
  autoRefreshTimer: number | null = null;

  /**
   * 清除所有定时器
   */
  clearAllTimers(): void {
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (this.autoRefreshTimer !== null) {
      window.clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  /**
   * 追加安装日志
   */
  appendLog(line: string): void {
    this.installLog = `${this.installLog}\n${line}`;
  }

  /**
   * 更新工具分类列表
   */
  updateCategories(): void {
    this.categories = Array.from(new Set(this.dataCache.map((item) => item.category))).sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );

    // 如果当前选中的分类不存在，重置为 "all"
    if (!this.categories.includes(this.filters.category) && this.filters.category !== "all") {
      this.filters.category = "all";
    }
  }

  /**
   * 获取工具唯一标识
   */
  getToolIdentity(tool: ToolStatus): string {
    return `${tool.name}::${tool.command}`;
  }
}

/** 全局 Tools 状态实例 */
export const toolsState = new ToolsState();
