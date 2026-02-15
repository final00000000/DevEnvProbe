import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, ToolStatus, InstallResult, UninstallResult } from "../types";
import { toolsState } from "../state";
import { TOOLS_CACHE_TTL_MS } from "../constants/config";
import { npmPackageMap, marketMetaMap } from "../config/app-config";

const NPM_DOWNLOAD_TIMEOUT_MS = 2600;

// 重试策略配置
const RETRY_BASE_DELAY_MS = 300;  // 基础延迟 300ms
const RETRY_MAX_DELAY_MS = 900;   // 最大延迟 900ms
const RETRY_BACKOFF_FACTOR = 1.5; // 指数退避因子
const RETRY_JITTER_PERCENT = 0.2; // 抖动比例 ±20%

export type ErrorType = "transient" | "fatal";

export interface RefreshCacheResult {
  ok: boolean;
  error: string | null;
  errorType?: ErrorType;
  usedCache: boolean;
  retried: boolean;
}

/**
 * Tools 服务层 - 负责工具扫描和安装
 */
export class ToolsService {
  private inFlightRefreshPromise: Promise<RefreshCacheResult> | null = null;

  /**
   * 检查工具缓存是否过期
   */
  isCacheStale(): boolean {
    if (toolsState.lastScanAt === 0) {
      return true;
    }

    return Date.now() - toolsState.lastScanAt > TOOLS_CACHE_TTL_MS;
  }

  /**
   * 刷新工具缓存
   */
  async refreshCache(force: boolean): Promise<boolean> {
    const result = await this.refreshCacheDetailed(force);
    return result.ok;
  }

  async refreshCacheDetailed(force: boolean): Promise<RefreshCacheResult> {
    // 如果已有进行中的请求,复用同一个 Promise (单飞模式)
    if (this.inFlightRefreshPromise) {
      return this.inFlightRefreshPromise;
    }

    // 如果不强制刷新且缓存未过期,直接返回缓存
    if (!force && !this.isCacheStale() && toolsState.dataCache.length > 0) {
      return {
        ok: true,
        error: null,
        usedCache: false,
        retried: false,
      };
    }

    // 创建新的探测 Promise 并缓存
    this.inFlightRefreshPromise = (async (): Promise<RefreshCacheResult> => {
      toolsState.refreshing = true;
      toolsState.scanStartedAt = Date.now();
      toolsState.scanSoftTimeoutActive = false;

      try {
        const firstAttempt = await this.detectToolsSnapshot();
        if (firstAttempt.ok && firstAttempt.data) {
          this.applyToolsSnapshot(firstAttempt.data, firstAttempt.elapsedMs);
          this.resetRefreshErrorState();

          return {
            ok: true,
            error: null,
            usedCache: false,
            retried: false,
          };
        }

        // 使用指数退避计算重试延迟
        const retryDelay = this.calculateRetryDelay(1);
        await this.delay(retryDelay);

        const secondAttempt = await this.detectToolsSnapshot();
        if (secondAttempt.ok && secondAttempt.data) {
          this.applyToolsSnapshot(secondAttempt.data, secondAttempt.elapsedMs);
          this.resetRefreshErrorState();

          return {
            ok: true,
            error: null,
            usedCache: false,
            retried: true,
          };
        }

        const errorMessage = secondAttempt.error ?? firstAttempt.error ?? "探测失败，未返回有效数据";
        const usedCache = toolsState.dataCache.length > 0;

        toolsState.refreshFailCount += 1;
        toolsState.lastRefreshError = errorMessage;
        toolsState.lastRefreshErrorAt = Date.now();

        return {
          ok: false,
          error: errorMessage,
          errorType: usedCache ? "transient" : "fatal",
          usedCache,
          retried: true,
        };
      } finally {
        toolsState.refreshing = false;
        toolsState.scanSoftTimeoutActive = false;
        this.inFlightRefreshPromise = null;
      }
    })();

    return this.inFlightRefreshPromise;
  }

  private resetRefreshErrorState(): void {
    toolsState.refreshFailCount = 0;
    toolsState.lastRefreshError = null;
    toolsState.lastRefreshErrorAt = 0;
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   * @param attemptNumber 重试次数 (1, 2, 3, ...)
   * @returns 延迟时间（毫秒）
   */
  private calculateRetryDelay(attemptNumber: number): number {
    // 指数退避: baseDelay * (backoffFactor ^ (attemptNumber - 1))
    const exponentialDelay = RETRY_BASE_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attemptNumber - 1);

    // 限制最大延迟
    const cappedDelay = Math.min(exponentialDelay, RETRY_MAX_DELAY_MS);

    // 添加抖动 (±20%)，避免雷鸣群效应
    const jitterRange = cappedDelay * RETRY_JITTER_PERCENT;
    const jitter = jitterRange * (Math.random() * 2 - 1);

    return Math.round(cappedDelay + jitter);
  }

  private async detectToolsSnapshot(): Promise<CommandResponse<ToolStatus[]>> {
    try {
      return await invoke<CommandResponse<ToolStatus[]>>("detect_dev_tools");
    } catch (error) {
      return {
        ok: false,
        data: null,
        error: `调用异常：${String(error)}`,
        elapsedMs: 0,
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  /**
   * 应用工具快照数据
   */
  private applyToolsSnapshot(nextTools: ToolStatus[], elapsedMs: number): void {
    const previousInstalledMap = new Map<string, boolean>();
    toolsState.dataCache.forEach((tool) => {
      previousInstalledMap.set(toolsState.getToolIdentity(tool), tool.installed);
    });

    let diffInstalled = 0;
    let diffMissing = 0;

    nextTools.forEach((tool) => {
      const key = toolsState.getToolIdentity(tool);
      const previous = previousInstalledMap.get(key);
      if (previous === undefined) {
        return;
      }

      if (!previous && tool.installed) {
        diffInstalled += 1;
      }

      if (previous && !tool.installed) {
        diffMissing += 1;
      }
    });

    toolsState.dataCache = nextTools;
    toolsState.diffInstalled = diffInstalled;
    toolsState.diffMissing = diffMissing;
    toolsState.lastScanAt = Date.now();
    toolsState.lastScanElapsedMs = elapsedMs;

    toolsState.updateCategories();
  }

  /**
   * 安装工具
   */
  async installTool(itemKey: string, installPath: string | null): Promise<CommandResponse<InstallResult>> {
    const response = await invoke<CommandResponse<InstallResult>>("install_market_item", {
      itemKey,
      installPath: installPath?.trim() || null,
    });

    return response;
  }

  /**
   * 卸载工具
   */
  async uninstallTool(itemKey: string): Promise<CommandResponse<UninstallResult>> {
    const response = await invoke<CommandResponse<UninstallResult>>("uninstall_market_item", {
      itemKey,
    });

    return response;
  }

  /**
   * 检查 winget 前置条件
   */
  async checkWingetPrerequisite(): Promise<CommandResponse<{ available: boolean; version: string | null; error: string | null }>> {
    try {
      return await invoke<CommandResponse<{ available: boolean; version: string | null; error: string | null }>>("check_winget_prerequisite");
    } catch (error) {
      return {
        ok: false,
        data: null,
        error: `检查 winget 失败：${String(error)}`,
        elapsedMs: 0,
      };
    }
  }

  /**
   * 自动安装 App Installer
   */
  async installAppInstaller(): Promise<CommandResponse<InstallResult>> {
    try {
      return await invoke<CommandResponse<InstallResult>>("install_app_installer_auto");
    } catch (error) {
      return {
        ok: false,
        data: null,
        error: `安装 App Installer 失败：${String(error)}`,
        elapsedMs: 0,
      };
    }
  }

  /**
   * 格式化相对时间
   */
  formatRelativeTime(timestamp: number): string {
    if (timestamp <= 0) {
      return "未探测";
    }

    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 15_000) {
      return "刚刚";
    }

    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 60) {
      return `${minutes} 分钟前`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} 小时前`;
    }

    const days = Math.floor(hours / 24);
    return `${days} 天前`;
  }

  /**
   * 预加载工具检测（应用启动时调用）
   * 在后台异步执行，不阻塞 UI，错误静默处理
   */
  async preloadDetection(): Promise<void> {
    try {
      // 如果已有缓存且未过期，跳过预加载
      if (!this.isCacheStale() && toolsState.dataCache.length > 0) {
        return;
      }

      // 后台异步刷新缓存，不等待结果
      void this.refreshCache(false).catch(() => {
        // 预加载失败静默处理，不影响应用启动
      });
    } catch {
      // 预加载异常静默处理
    }
  }

  /**
   * 异步获取 npm 包下载量并更新 marketMetaMap
   */
  async fetchNpmDownloads(): Promise<void> {
    const entries = Object.entries(npmPackageMap);
    if (entries.length === 0) {
      return;
    }

    const names = entries.map(([, pkg]) => pkg);
    const encodedNames = names.map((name) => encodeURIComponent(name));
    const url = `https://api.npmjs.org/downloads/point/last-week/${encodedNames.join(",")}`;
    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => {
      controller.abort();
    }, NPM_DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        return;
      }

      const data = await response.json();

      for (const [installKey, npmName] of entries) {
        const record = names.length === 1 ? data : data[npmName];
        if (!record || typeof record.downloads !== "number") {
          continue;
        }

        const meta = marketMetaMap[installKey];
        if (meta) {
          meta.downloads = this.formatDownloadCount(record.downloads);
        }
      }
    } catch {
      // 网络不可用时静默忽略
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  }

  private formatDownloadCount(count: number): string {
    if (count >= 100_000_000) {
      return `${(count / 100_000_000).toFixed(1)}亿/周`;
    }
    if (count >= 10_000) {
      return `${Math.round(count / 10_000)}万/周`;
    }
    return `${count}/周`;
  }
}

/** 全局 Tools 服务实例 */
export const toolsService = new ToolsService();
