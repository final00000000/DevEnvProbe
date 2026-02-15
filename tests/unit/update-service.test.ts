import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  downloadAndInstall,
  type UpdateProgress,
} from "../../src/services/update-service";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

describe("update-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkForUpdates 无更新时应返回 latest", async () => {
    (check as any).mockResolvedValue(null);

    const result = await checkForUpdates();

    expect(result.kind).toBe("latest");
  });

  it("checkForUpdates 有更新时应返回 available", async () => {
    (check as any).mockResolvedValue({
      version: "0.2.0",
      date: "2026-02-14",
      body: "更新说明",
    });

    const result = await checkForUpdates();

    expect(result).toMatchObject({
      kind: "available",
      version: "0.2.0",
      date: "2026-02-14",
      body: "更新说明",
    });
  });

  it("checkForUpdates 异常时应返回 error", async () => {
    (check as any).mockRejectedValue(new Error("network down"));

    const result = await checkForUpdates();

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("network down");
    }
  });

  it("downloadAndInstall 无可用更新时应返回 false", async () => {
    (check as any).mockResolvedValue(null);

    const ok = await downloadAndInstall();

    expect(ok).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("downloadAndInstall 成功时应回调进度并调用 relaunch", async () => {
    const progressRecords: UpdateProgress[] = [];
    const downloadAndInstallMock = vi.fn(async (onEvent?: (event: any) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 30 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 70 } });
      onEvent?.({ event: "Finished" });
    });

    (check as any).mockResolvedValue({
      downloadAndInstall: downloadAndInstallMock,
    });
    (relaunch as any).mockResolvedValue(undefined);

    const ok = await downloadAndInstall((progress) => {
      progressRecords.push(progress);
    });

    expect(ok).toBe(true);
    expect(downloadAndInstallMock).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(progressRecords[0]).toMatchObject({ downloaded: 0, total: 100, percentage: 0 });
    expect(progressRecords.some((item) => item.percentage === 100)).toBe(true);
  });
});
