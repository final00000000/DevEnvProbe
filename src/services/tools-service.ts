import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, ToolStatus, InstallResult } from "../types";
import { toolsState } from "../state";
import { TOOLS_CACHE_TTL_MS } from "../constants/config";

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
    if (toolsState.refreshing) {
      return toolsState.dataCache.length > 0;
    }

    if (!force && !this.isCacheStale() && toolsState.dataCache.length > 0) {
      return true;
    }

    toolsState.refreshing = true;
    try {
      const response = await invoke<CommandResponse<ToolStatus[]>>("detect_dev_tools");
      if (!response.ok || !response.data) {
        return false;
      }

      this.applyToolsSnapshot(response.data, response.elapsedMs);
      return true;
    } finally {
      toolsState.refreshing = false;
    }
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
}

/** 全局 Tools 服务实例 */
export const toolsService = new ToolsService();
