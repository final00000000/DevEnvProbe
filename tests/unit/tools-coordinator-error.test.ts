import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsCoordinator } from "../../src/pages/tools/ToolsCoordinator";
import { appState, toolsState } from "../../src/state";
import * as shellUi from "../../src/modules/shell-ui";

describe("ToolsCoordinator 错误分级交互", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    appState.currentPage = "tools";
    toolsState.dataCache = [
      {
        name: "Node",
        command: "node",
        category: "Runtime",
        installed: true,
        version: "v20",
        details: null,
        installKey: null,
        installPath: null,
      },
    ];
  });

  it("transient 失败应展示缓存结果提示，不显示恢复成功提示", async () => {
    const coordinator = new ToolsCoordinator();
    const container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);

    vi.spyOn(coordinator, "runRefreshWithSoftTimeout").mockResolvedValue({
      ok: false,
      error: "探测失败",
      errorType: "transient",
      usedCache: true,
      retried: true,
    });
    const renderWithDataSpy = vi.spyOn(coordinator, "renderWithData").mockImplementation(() => {});
    const renderErrorSpy = vi.spyOn(coordinator, "renderErrorState").mockImplementation(() => {});
    const noticeSpy = vi.spyOn(shellUi, "showGlobalNotice").mockImplementation(() => {});

    await coordinator.handleRefresh(container);

    expect(renderWithDataSpy).toHaveBeenCalled();
    expect(renderErrorSpy).not.toHaveBeenCalled();

    const noticeTitles = noticeSpy.mock.calls.map((call) => call[0]);
    expect(noticeTitles).toContain("环境探测失败");
    expect(noticeTitles).not.toContain("环境探测已恢复");
  });

  it("fatal 失败应进入错误页并提示失败", async () => {
    const coordinator = new ToolsCoordinator();
    const container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);

    vi.spyOn(coordinator, "runRefreshWithSoftTimeout").mockResolvedValue({
      ok: false,
      error: "严重错误",
      errorType: "fatal",
      usedCache: false,
      retried: true,
    });
    const renderWithDataSpy = vi.spyOn(coordinator, "renderWithData").mockImplementation(() => {});
    const renderErrorSpy = vi.spyOn(coordinator, "renderErrorState").mockImplementation(() => {});
    const noticeSpy = vi.spyOn(shellUi, "showGlobalNotice").mockImplementation(() => {});

    await coordinator.handleRefresh(container);

    expect(renderWithDataSpy).not.toHaveBeenCalled();
    expect(renderErrorSpy).toHaveBeenCalled();
    expect(noticeSpy.mock.calls.map((call) => call[0])).toContain("环境探测失败");
  });
});
