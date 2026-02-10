import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, ToolStatus, InstallResult, UninstallResult } from "../types";
import { toolsState } from "../state";
import { TOOLS_CACHE_TTL_MS } from "../constants/config";
import { npmPackageMap, marketMetaMap } from "../config/app-config";

const TOOLS_REFRESH_RETRY_DELAY_MS = 240;
const NPM_DOWNLOAD_TIMEOUT_MS = 2600;

export interface RefreshCacheResult {
  ok: boolean;
  error: string | null;
  usedCache: boolean;
  retried: boolean;
}

/**
 * Tools 服务层 - 负责工具扫描和安装
 */
export class ToolsService {
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
    if (toolsState.refreshing) {
      const hasCache = toolsState.dataCache.length > 0;
      return {
        ok: hasCache,
        error: hasCache ? null : "探测任务进行中",
        usedCache: hasCache,
        retried: false,
      };
    }

    if (!force && !this.isCacheStale() && toolsState.dataCache.length > 0) {
      return {
        ok: true,
        error: null,
        usedCache: false,
        retried: false,
      };
    }

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

      await this.delay(TOOLS_REFRESH_RETRY_DELAY_MS);

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
        ok: usedCache,
        error: errorMessage,
        usedCache,
        retried: true,
      };
    } finally {
      toolsState.refreshing = false;
      toolsState.scanSoftTimeoutActive = false;
    }
  }

  private resetRefreshErrorState(): void {
    toolsState.refreshFailCount = 0;
    toolsState.lastRefreshError = null;
    toolsState.lastRefreshErrorAt = 0;
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
  async installTool(itemKey: string, installPath: string): Promise<CommandResponse<InstallResult>> {
    const response = await invoke<CommandResponse<InstallResult>>("install_market_item", {
      itemKey,
      installPath: installPath.trim() || null,
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
   * 选择安装目录
   */
  async pickInstallDirectory(): Promise<string | null> {
    const response = await invoke<CommandResponse<string | null>>("pick_install_directory");
    if (!response.ok || !response.data) {
      return null;
    }

    return response.data;
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
