/**
 * 状态管理中心
 * 集中导出所有状态实例
 */

export { systemState, SystemState } from "./system-state";
export { toolsState, ToolsState } from "./tools-state";
export { dockerState, DockerState } from "./docker-state";

import type { PageKey } from "../types";

/**
 * 应用全局状态
 */
export class AppState {
  /** 当前页面 */
  currentPage: PageKey = "system";

  /** 页面渲染版本号（用于取消过期渲染） */
  pageRenderEpoch = 0;

  /**
   * 递增渲染版本号
   */
  incrementRenderEpoch(): number {
    return ++this.pageRenderEpoch;
  }

  /**
   * 检查渲染是否过期
   */
  isRenderStale(renderEpoch: number, page: PageKey): boolean {
    return renderEpoch !== this.pageRenderEpoch || this.currentPage !== page;
  }
}

/** 全局应用状态实例 */
export const appState = new AppState();
