import type { SystemSnapshot } from "../types";
import { createSystemTrendState } from "../modules/system-trend-state";
import { SYSTEM_TREND_MAX_POINTS } from "../constants/config";

/**
 * System 页面状态管理
 */
export class SystemState {
  /** 系统快照缓存 */
  snapshotCache: SystemSnapshot | null = null;

  /** 系统刷新循环定时器 */
  refreshLoopTimer: number | null = null;

  /** 系统刷新循环激活状态 */
  refreshLoopActive = false;

  /** 系统刷新请求进行中标志 */
  refreshInFlight = false;

  /** 系统运行时长 Ticker 定时器 */
  uptimeTickTimer: number | null = null;

  /** 系统运行时长锚点（秒） */
  uptimeAnchorSeconds = 0;

  /** 系统运行时长锚点时间戳（ms） */
  uptimeAnchorAtMs = 0;

  /** 应用可见性状态 */
  appIsVisible = true;

  /** 恢复刷新延迟时间戳（ms） */
  resumeDeferUntilMs = 0;

  /** 恢复刷新定时器 */
  resumeRefreshTimer: number | null = null;

  /** 系统趋势状态 */
  trendState = createSystemTrendState(SYSTEM_TREND_MAX_POINTS);

  /** 系统快照最后获取时间戳（ms） */
  snapshotLastFetchedAt = 0;

  /**
   * 重置所有定时器
   */
  clearAllTimers(): void {
    if (this.refreshLoopTimer !== null) {
      window.clearTimeout(this.refreshLoopTimer);
      this.refreshLoopTimer = null;
    }

    if (this.uptimeTickTimer !== null) {
      window.clearInterval(this.uptimeTickTimer);
      this.uptimeTickTimer = null;
    }

    if (this.resumeRefreshTimer !== null) {
      window.clearTimeout(this.resumeRefreshTimer);
      this.resumeRefreshTimer = null;
    }

    this.refreshLoopActive = false;
  }

  /**
   * 更新运行时长锚点
   */
  updateUptimeAnchor(uptimeSeconds: number): void {
    const normalizedUptime = Math.max(0, Math.floor(uptimeSeconds));
    if (normalizedUptime <= 0 && this.uptimeAnchorSeconds > 0) {
      return;
    }

    this.uptimeAnchorSeconds = normalizedUptime;
    this.uptimeAnchorAtMs = Date.now();
  }

  /**
   * 获取锚定的运行时长（秒）
   */
  getAnchoredUptimeSeconds(): number {
    if (this.uptimeAnchorAtMs <= 0) {
      return this.uptimeAnchorSeconds;
    }

    const deltaSeconds = Math.floor((Date.now() - this.uptimeAnchorAtMs) / 1000);
    return this.uptimeAnchorSeconds + Math.max(0, deltaSeconds);
  }
}

/** 全局 System 状态实例 */
export const systemState = new SystemState();
