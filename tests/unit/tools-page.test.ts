import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsPage } from "../../src/pages/ToolsPage";
import { appState, toolsState } from "../../src/state";
import { toolsService } from "../../src/services";

describe("ToolsPage 软超时加载", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();

    appState.currentPage = "tools";
    appState.pageRenderEpoch = 0;

    toolsState.dataCache = [];
    toolsState.categories = [];
    toolsState.filters.search = "";
    toolsState.filters.status = "all";
    toolsState.filters.category = "all";
    toolsState.refreshing = false;
    toolsState.scanSoftTimeoutMs = 30;
    toolsState.scanSoftTimeoutActive = false;
    toolsState.lastScanAt = 0;
    toolsState.lastRefreshError = null;
    toolsState.lastRefreshErrorAt = 0;
    toolsState.diffInstalled = 0;
    toolsState.diffMissing = 0;

    vi.spyOn(toolsService, "fetchNpmDownloads").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次扫描超过软超时应展示卡片级加载框", async () => {
    let resolveRefresh: ((value: any) => void) | null = null;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    vi.spyOn(toolsService, "refreshCacheDetailed").mockImplementation(async () => {
      toolsState.refreshing = true;
      const result = await (refreshPromise as Promise<any>);
      toolsState.refreshing = false;
      return result;
    });

    const page = new ToolsPage();
    const container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);

    const renderPromise = page.render(container, 0);
    await vi.advanceTimersByTimeAsync(40);

    expect(container.querySelector(".tool-scan-loading")).not.toBeNull();

    resolveRefresh?.({
      ok: true,
      error: null,
      usedCache: false,
      retried: false,
    });
    await renderPromise;
  });

  it("已有缓存且软超时触发时应在条目中显示加载框", () => {
    const page = new ToolsPage();
    const container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);

    toolsState.dataCache = [
      {
        name: "Docker",
        command: "docker",
        category: "Container",
        installed: true,
        version: "v24",
        details: null,
        installKey: "docker-desktop",
        installPath: null,
      },
    ];
    toolsState.updateCategories();
    toolsState.refreshing = true;
    toolsState.scanSoftTimeoutActive = true;

    page.renderWithData(container);

    expect(container.querySelector(".tool-scan-loading")).not.toBeNull();
  });
});
