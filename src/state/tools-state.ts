import type { ToolStatus, ToolFilterState, InstallFeedbackLevel } from "../types";
import { TOOLS_SCAN_SOFT_TIMEOUT_MS } from "../constants/config";

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

  /** 正在卸载的工具 Key */
  uninstallingKey: string | null = null;

  /** 安装日志 */
  installLog = "等待安装任务...";

  /** 安装状态文本 */
  installState = "";

  /** 安装进度（0-100） */
  installProgress = 0;

  /** 安装进度说明 */
  installMessage = "待命中";

  /** 安装反馈等级 */
  installFeedbackLevel: InstallFeedbackLevel = "idle";

  /** 安装反馈标题 */
  installFeedbackTitle = "";

  /** 安装反馈详情 */
  installFeedbackDetail = "";

  /** 当前安装进度动画定时器 */
  installProgressTimer: number | null = null;

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

  /** 最近一次刷新错误信息 */
  lastRefreshError: string | null = null;

  /** 最近一次刷新错误时间戳（ms） */
  lastRefreshErrorAt = 0;

  /** 连续刷新失败次数 */
  refreshFailCount = 0;

  /** 扫描开始时间戳（ms） */
  scanStartedAt = 0;

  /** 扫描软超时是否已触发 */
  scanSoftTimeoutActive = false;

  /** 扫描软超时阈值（ms） */
  scanSoftTimeoutMs = TOOLS_SCAN_SOFT_TIMEOUT_MS;

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

    if (this.installProgressTimer !== null) {
      window.clearTimeout(this.installProgressTimer);
      this.installProgressTimer = null;
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
