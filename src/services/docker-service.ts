import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, DockerCommandResult } from "../types";
import { dockerState } from "../state";
import { DOCKER_OVERVIEW_REFRESH_TTL_MS } from "../constants/config";
import {
  parseDockerContainers,
  parseDockerImages,
  parseDockerStats,
  parseDockerCompose,
  buildDockerSummary,
  clearDockerContainerFilterCache,
  firstMeaningfulLine,
} from "../modules/docker-data";

export type DockerOverviewMode = "quick" | "full";

/**
 * Docker 服务层 - 负责 Docker 命令执行和数据处理
 */
export class DockerService {
  /**
   * 检查概览数据是否过期
   */
  isOverviewStale(): boolean {
    return Date.now() - dockerState.lastOverviewAt > DOCKER_OVERVIEW_REFRESH_TTL_MS;
  }

  /**
   * 执行 Docker 命令
   */
  async runDockerAction(action: string, target?: string): Promise<CommandResponse<DockerCommandResult>> {
    return await invoke<CommandResponse<DockerCommandResult>>("run_docker_action", {
      action,
      target,
    });
  }

  /**
   * 获取概览需要执行的命令列表
   */
  getOverviewActions(mode: DockerOverviewMode): string[] {
    const quickActions = ["version", "ps", "images", "compose_ls"];
    if (dockerState.activeTab === "stats") {
      quickActions.push("stats");
    }

    if (mode === "quick") {
      return quickActions;
    }

    return ["version", "info", "ps", "images", "stats", "compose_ls", "system_df"];
  }

  /**
   * 刷新 Docker 概览数据
   */
  async refreshOverview(mode: DockerOverviewMode = "quick"): Promise<void> {
    if (dockerState.pendingAction !== null) {
      return;
    }

    const taskName = mode === "quick" ? "quick-overview" : "overview";
    dockerState.setPendingAction(taskName);
    dockerState.status = `执行中: ${taskName}`;
    dockerState.output = mode === "quick" ? "正在快速刷新 Docker 概览..." : "正在批量刷新 Docker 概览...";

    try {
      const response = await invoke<CommandResponse<DockerCommandResult[]>>("get_docker_overview_batch", {
        mode,
      });

      if (!response.ok || !response.data) {
        dockerState.status = "概览刷新失败";
        dockerState.output = response.error ?? "未返回有效数据";
        return;
      }

      const batchResults = response.data;
      for (let index = 0; index < batchResults.length; index += 1) {
        const result = batchResults[index];
        this.applyActionResult(result, false);

        dockerState.output = `[${result.command}]\nexit=${result.exitCode}\n\n${result.stdout || "(无输出)"}${
          result.stderr ? `\n\n[stderr]\n${result.stderr}` : ""
        }`;

        if (index < batchResults.length - 1) {
          await this.nextFrame();
        }
      }

      dockerState.lastOverviewAt = Date.now();
      dockerState.status = mode === "quick" ? "快速概览刷新完成" : "概览刷新完成";
    } catch (error) {
      dockerState.status = "概览刷新异常";
      dockerState.output = `调用异常\n${String(error)}`;
    } finally {
      dockerState.pendingAction = null;
    }
  }

  private async nextFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  /**
   * 应用 Docker 命令结果
   */
  applyActionResult(result: DockerCommandResult, switchTab: boolean): void {
    dockerState.dashboard.lastAction = result.action;
    dockerState.dashboard.lastCommand = result.command;
    dockerState.dashboard.rawOutput = dockerState.output;
    dockerState.markPanelDirty();

    switch (result.action) {
      case "version": {
        dockerState.dashboard.versionText = firstMeaningfulLine(result.stdout) ?? "(无输出)";
        break;
      }
      case "info": {
        dockerState.dashboard.infoText = firstMeaningfulLine(result.stdout) ?? "(无输出)";
        break;
      }
      case "ps": {
        clearDockerContainerFilterCache();
        dockerState.dashboard.containers = parseDockerContainers(result.stdout);
        if (switchTab) {
          dockerState.activeTab = "containers";
        }
        break;
      }
      case "images": {
        dockerState.dashboard.images = parseDockerImages(result.stdout);
        if (switchTab) {
          dockerState.activeTab = "images";
        }
        break;
      }
      case "stats": {
        dockerState.dashboard.stats = parseDockerStats(result.stdout);
        if (switchTab) {
          dockerState.activeTab = "stats";
        }
        break;
      }
      case "compose_ls": {
        dockerState.dashboard.compose = parseDockerCompose(result.stdout);
        if (switchTab) {
          dockerState.activeTab = "compose";
        }
        break;
      }
      case "system_df": {
        dockerState.dashboard.systemDf = result.stdout || "(无输出)";
        break;
      }
      default:
        break;
    }

    dockerState.dashboard.summary = buildDockerSummary(dockerState.dashboard);
  }
}

/** 全局 Docker 服务实例 */
export const dockerService = new DockerService();
