import type {
  DockerActionType,
  DockerDashboardState,
  DockerFilterState,
  DockerPanelTab,
  DockerSelectionKind,
} from "../types";
import { createEmptyDockerState } from "../modules/docker-data";

/**
 * Docker 页面状态管理
 */
export class DockerState {
  /** 高风险确认态有效时长（ms） */
  static readonly DANGER_CONFIRM_TTL_MS = 8_000;

  /** Docker 状态文本 */
  status = "等待加载 Docker 数据";

  /** Docker 原始输出 */
  output = "等待执行命令...";

  /** Docker 待执行动作 */
  pendingAction: DockerActionType | "quick-overview" | "overview" | null = null;

  /** Docker 当前激活的 Tab */
  activeTab: DockerPanelTab = "containers";

  /** Docker 目标容器名称/ID */
  target = "";

  /** Docker 高级模式（危险操作）是否开启 */
  advancedModeEnabled = false;

  /** Docker 输出抽屉是否展开 */
  outputDrawerOpen = false;

  /** Docker 当前选中对象 */
  selected: { kind: DockerSelectionKind; key: string } | null = null;

  /** Docker 危险操作确认状态 */
  dangerConfirm: { action: "rm" | "rmi"; target: string; expiresAt: number } | null = null;

  /** Docker 是否已初始化 */
  bootstrapped = false;

  /** Docker 筛选状态 */
  filters: DockerFilterState = {
    search: "",
    status: "all",
  };

  /** Docker Dashboard 数据 */
  dashboard: DockerDashboardState = createEmptyDockerState();

  /** Docker 概览最后刷新时间戳（ms） */
  lastOverviewAt = 0;

  /** Docker 搜索防抖定时器 */
  searchDebounceTimer: number | null = null;

  /** Docker 面板需要刷新标志 */
  panelNeedsRefresh = true;

  /**
   * 清除所有定时器
   */
  clearAllTimers(): void {
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }

  /**
   * 设置待执行动作
   */
  setPendingAction(action: DockerActionType | "quick-overview" | "overview" | null): void {
    this.pendingAction = action;
    if (action) {
      this.status = `执行中: ${action}`;
    }
  }

  /**
   * 设置危险动作确认态
   */
  armDangerConfirm(action: "rm" | "rmi", target: string): void {
    this.dangerConfirm = {
      action,
      target,
      expiresAt: Date.now() + DockerState.DANGER_CONFIRM_TTL_MS,
    };
  }

  /**
   * 检查并清理过期危险确认态
   */
  consumeDangerConfirm(action: "rm" | "rmi", target: string): boolean {
    if (!this.dangerConfirm) {
      return false;
    }

    const matched =
      this.dangerConfirm.action === action &&
      this.dangerConfirm.target === target &&
      this.dangerConfirm.expiresAt >= Date.now();

    this.dangerConfirm = null;
    return matched;
  }

  /**
   * 标记面板需要刷新
   */
  markPanelDirty(): void {
    this.panelNeedsRefresh = true;
  }
}

/** 全局 Docker 状态实例 */
export const dockerState = new DockerState();
