/**
 * 应用更新服务
 *
 * 职责：
 * 1. 检查应用更新
 * 2. 下载并安装更新
 * 3. 管理更新状态
 */

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateCheckResult =
  | {
      kind: "available";
      version: string;
      date?: string;
      body?: string;
    }
  | {
      kind: "latest";
    }
  | {
      kind: "error";
      message: string;
      cause?: unknown;
    };

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/**
 * 检查是否有可用更新
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const update = await check();

    if (update) {
      return {
        kind: "available",
        version: update.version,
        date: update.date,
        body: update.body,
      };
    }

    return { kind: "latest" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("更新检查失败:", error);
    return { kind: "error", message, cause: error };
  }
}

/**
 * 下载并安装更新
 * @param onProgress 下载进度回调
 */
export async function downloadAndInstall(
  onProgress?: (progress: UpdateProgress) => void
): Promise<boolean> {
  try {
    const update = await check();

    if (!update) {
      return false;
    }

    let totalDownloaded = 0;
    let totalBytes: number | null = null;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        console.log("开始下载更新...");
        totalDownloaded = 0;
        totalBytes = typeof event.data.contentLength === "number" ? event.data.contentLength : null;
        onProgress?.({ downloaded: 0, total: totalBytes ?? 0, percentage: 0 });
      } else if (event.event === "Progress") {
        totalDownloaded += event.data.chunkLength;
        const percentage = totalBytes && totalBytes > 0
          ? Math.min(100, (totalDownloaded / totalBytes) * 100)
          : 0;
        onProgress?.({
          downloaded: totalDownloaded,
          total: totalBytes ?? 0,
          percentage,
        });
      } else if (event.event === "Finished") {
        console.log("更新下载完成");
        onProgress?.({
          downloaded: totalDownloaded,
          total: totalBytes ?? totalDownloaded,
          percentage: 100,
        });
      }
    });

    // 重启应用以应用更新
    await relaunch();
    return true;
  } catch (error) {
    console.error("更新下载/安装失败:", error);
    return false;
  }
}

/**
 * 静默检查更新（应用启动时调用）
 * @param delayMs 延迟检查时间（毫秒）
 */
export async function silentCheckForUpdates(delayMs = 5000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  try {
    const updateInfo = await checkForUpdates();

    if (updateInfo.kind === "available") {
      console.log(`发现新版本: ${updateInfo.version}`);
      // 可以在这里显示通知或更新提示
    } else if (updateInfo.kind === "error") {
      console.debug("静默更新检查失败:", updateInfo.message);
    }
  } catch (error) {
    // 静默失败，不影响应用启动
    console.debug("静默更新检查失败:", error);
  }
}
