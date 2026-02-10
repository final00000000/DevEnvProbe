import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, SystemSnapshot, SystemRealtimeSnapshot } from "../types";
import { systemState } from "../state";
import {
  SYSTEM_REFRESH_SLOW_MIN_DELAY_MS,
  SYSTEM_REFRESH_SLOW_THRESHOLD_MS,
  SYSTEM_SNAPSHOT_SOFT_TIMEOUT_MS,
  SYSTEM_SNAPSHOT_TTL_MS,
  SYSTEM_REALTIME_SOFT_TIMEOUT_MS,
} from "../constants/config";
import { clampPercent } from "../utils/formatters";
import { pushSystemTrendPoint } from "../modules/system-trend-state";

/**
 * System 服务层 - 负责系统数据获取和处理
 */
export class SystemService {
  private snapshotInFlight: Promise<CommandResponse<SystemSnapshot>> | null = null;

  private realtimeInFlight: Promise<CommandResponse<SystemRealtimeSnapshot>> | null = null;

  /**
   * 检查系统快照缓存是否新鲜
   */
  isSnapshotFresh(): boolean {
    const snapshot = systemState.snapshotCache;
    if (!snapshot) {
      return false;
    }

    if (snapshot.isStale === true) {
      return false;
    }

    if (snapshot.totalMemoryGb <= 0) {
      return false;
    }

    if (snapshot.cpuCores <= 0 && snapshot.cpuLogicalCores <= 0) {
      return false;
    }

    const now = Date.now();
    return now - systemState.snapshotLastFetchedAt < SYSTEM_SNAPSHOT_TTL_MS;
  }

  /**
   * 获取完整系统快照
   */
  async fetchSystemSnapshot(): Promise<CommandResponse<SystemSnapshot>> {
    if (this.snapshotInFlight) {
      return this.snapshotInFlight;
    }

    this.snapshotInFlight = this.fetchSystemSnapshotInternal();
    try {
      return await this.snapshotInFlight;
    } finally {
      this.snapshotInFlight = null;
    }
  }

  private async fetchSystemSnapshotInternal(): Promise<CommandResponse<SystemSnapshot>> {
    const invokePromise = invoke<CommandResponse<SystemSnapshot>>("get_system_snapshot");
    void invokePromise
      .then((lateResponse) => {
        if (!lateResponse.ok || !lateResponse.data) {
          return;
        }

        this.applySnapshotToCache(lateResponse.data);
      })
      .catch(() => {
      });

    const response = await this.withSoftTimeout(
      invokePromise,
      SYSTEM_SNAPSHOT_SOFT_TIMEOUT_MS,
      this.buildSnapshotTimeoutFallback("系统快照请求超时，已回退缓存数据")
    );

    if (response.ok && response.data) {
      const snapshot = this.applySnapshotToCache(response.data);
      return {
        ...response,
        data: snapshot,
      };
    }

    return response;
  }

  private applySnapshotToCache(snapshot: SystemSnapshot): SystemSnapshot {
    const normalizedSnapshot: SystemSnapshot = {
      ...snapshot,
      cpuUsagePercent: clampPercent(snapshot.cpuUsagePercent),
      memoryUsagePercent: clampPercent(snapshot.memoryUsagePercent),
    };

    systemState.snapshotCache = normalizedSnapshot;
    systemState.snapshotLastFetchedAt = normalizedSnapshot.isStale ? 0 : Date.now();
    systemState.updateUptimeAnchor(normalizedSnapshot.uptimeSeconds);

    return normalizedSnapshot;
  }

  /**
   * 获取系统实时数据（轻量级）
   */
  async fetchSystemRealtime(): Promise<CommandResponse<SystemRealtimeSnapshot>> {
    if (this.realtimeInFlight) {
      return this.realtimeInFlight;
    }

    this.realtimeInFlight = this.fetchSystemRealtimeInternal();
    try {
      return await this.realtimeInFlight;
    } finally {
      this.realtimeInFlight = null;
    }
  }

  private async fetchSystemRealtimeInternal(): Promise<CommandResponse<SystemRealtimeSnapshot>> {
    const invokePromise = invoke<CommandResponse<SystemRealtimeSnapshot>>("get_system_realtime");
    const response = await this.withSoftTimeout(
      invokePromise,
      SYSTEM_REALTIME_SOFT_TIMEOUT_MS,
      this.buildRealtimeTimeoutFallback("系统实时请求超时，已回退缓存数据")
    );

    if (response.ok && response.data) {
      const realtime = response.data;
      const cpuUsagePercent = clampPercent(realtime.cpuUsagePercent);
      const memoryUsagePercent = clampPercent(realtime.memoryUsagePercent);

      // 更新趋势数据
      pushSystemTrendPoint(systemState.trendState, cpuUsagePercent, memoryUsagePercent);

      // 应用到缓存
      this.applyRealtimeToCache(realtime);
      systemState.updateUptimeAnchor(realtime.uptimeSeconds);
    }

    return response;
  }

  private buildSnapshotTimeoutFallback(error: string): CommandResponse<SystemSnapshot> {
    if (systemState.snapshotCache) {
      return {
        ok: true,
        data: {
          ...systemState.snapshotCache,
          isStale: true,
        },
        error,
        elapsedMs: SYSTEM_SNAPSHOT_SOFT_TIMEOUT_MS,
      };
    }

    return {
      ok: false,
      data: null,
      error,
      elapsedMs: SYSTEM_SNAPSHOT_SOFT_TIMEOUT_MS,
    };
  }

  private buildRealtimeTimeoutFallback(error: string): CommandResponse<SystemRealtimeSnapshot> {
    if (systemState.snapshotCache) {
      return {
        ok: true,
        data: {
          uptimeSeconds: systemState.snapshotCache.uptimeSeconds,
          cpuUsagePercent: systemState.snapshotCache.cpuUsagePercent,
          totalMemoryGb: systemState.snapshotCache.totalMemoryGb,
          usedMemoryGb: systemState.snapshotCache.usedMemoryGb,
          memoryUsagePercent: systemState.snapshotCache.memoryUsagePercent,
          sampleMode: "quick",
          sampledAtMs: Date.now(),
          isStale: true,
        },
        error,
        elapsedMs: SYSTEM_REALTIME_SOFT_TIMEOUT_MS,
      };
    }

    return {
      ok: false,
      data: null,
      error,
      elapsedMs: SYSTEM_REALTIME_SOFT_TIMEOUT_MS,
    };
  }

  private async withSoftTimeout<T>(
    targetPromise: Promise<CommandResponse<T>>,
    timeoutMs: number,
    fallback: CommandResponse<T>
  ): Promise<CommandResponse<T>> {
    let timeoutHandle: number | null = null;
    const guardedTargetPromise = targetPromise.catch((error) => {
      const normalizedError = String(error);
      return {
        ...fallback,
        error: fallback.error ? `${fallback.error}；调用异常：${normalizedError}` : `调用异常：${normalizedError}`,
      };
    });

    const timeoutPromise = new Promise<CommandResponse<T>>((resolve) => {
      timeoutHandle = window.setTimeout(() => {
        resolve(fallback);
      }, timeoutMs);
    });

    try {
      return await Promise.race([guardedTargetPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * 将实时数据应用到缓存快照
   */
  private applyRealtimeToCache(realtime: SystemRealtimeSnapshot): void {
    if (!systemState.snapshotCache) {
      return;
    }

    systemState.snapshotCache.cpuUsagePercent = clampPercent(realtime.cpuUsagePercent);
    systemState.snapshotCache.totalMemoryGb = realtime.totalMemoryGb;
    systemState.snapshotCache.usedMemoryGb = realtime.usedMemoryGb;
    systemState.snapshotCache.memoryUsagePercent = clampPercent(realtime.memoryUsagePercent);
    systemState.snapshotCache.uptimeSeconds = realtime.uptimeSeconds;
  }

  /**
   * 启动系统自动刷新循环
   */
  startAutoRefresh(onRefresh: () => Promise<void>): void {
    if (systemState.refreshLoopActive) {
      return;
    }

    systemState.refreshLoopActive = true;

    const runLoop = async (): Promise<void> => {
      if (!systemState.refreshLoopActive) {
        return;
      }

      const nowMs = Date.now();
      if (nowMs < systemState.resumeDeferUntilMs) {
        systemState.refreshLoopTimer = window.setTimeout(() => {
          void runLoop();
        }, Math.max(80, systemState.resumeDeferUntilMs - nowMs));
        return;
      }

      const startedAt = performance.now();
      await onRefresh();

      if (!systemState.refreshLoopActive) {
        return;
      }

      const elapsedMs = performance.now() - startedAt;
      const nextDelay = elapsedMs > SYSTEM_REFRESH_SLOW_THRESHOLD_MS
        ? Math.max(SYSTEM_REFRESH_SLOW_MIN_DELAY_MS, Math.floor(elapsedMs + 240))
        : Math.max(220, Math.floor(1000 - elapsedMs));

      systemState.refreshLoopTimer = window.setTimeout(() => {
        void runLoop();
      }, nextDelay);
    };

    void runLoop();
  }

  /**
   * 停止系统自动刷新循环
   */
  stopAutoRefresh(): void {
    systemState.refreshLoopActive = false;
    if (systemState.refreshLoopTimer !== null) {
      window.clearTimeout(systemState.refreshLoopTimer);
      systemState.refreshLoopTimer = null;
    }
  }

  /**
   * 启动运行时长 Ticker
   */
  startUptimeTicker(onTick: () => void): void {
    if (systemState.uptimeTickTimer !== null) {
      return;
    }

    const scheduleNextTick = () => {
      const now = Date.now();
      const delay = 1000 - (now % 1000) || 1000;

      systemState.uptimeTickTimer = window.setTimeout(() => {
        onTick();

        if (systemState.uptimeTickTimer !== null) {
          scheduleNextTick();
        }
      }, delay);
    };

    scheduleNextTick();
  }

  /**
   * 停止运行时长 Ticker
   */
  stopUptimeTicker(): void {
    if (systemState.uptimeTickTimer !== null) {
      window.clearTimeout(systemState.uptimeTickTimer);
      systemState.uptimeTickTimer = null;
    }
  }
}

/** 全局 System 服务实例 */
export const systemService = new SystemService();
