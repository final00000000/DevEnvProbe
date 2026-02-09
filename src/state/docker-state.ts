import type { DockerDashboardState, DockerFilterState, DockerPanelTab } from "../types";
import { createEmptyDockerState } from "../modules/docker-data";

/**
 * Docker 页面状态管理
 */
export class DockerState {
  /** Docker 状态文本 */
  status = "等待加载 Docker 数据";

  /** Docker 原始输出 */
  output = "等待执行命令...";

  /** Docker 待执行动作 */
  pendingAction: string | null = null;

  /** Docker 当前激活的 Tab */
  activeTab: DockerPanelTab = "containers";

  /** Docker 目标容器名称/ID */
  target = "";

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
  setPendingAction(action: string | null): void {
    this.pendingAction = action;
    if (action) {
      this.status = `执行中: ${action}`;
    }
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
