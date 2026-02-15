import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCKER_SEARCH_DEBOUNCE_MS } from "../../src/constants/config";
import { DockerPage } from "../../src/pages/docker/DockerPage";
import { appState, dockerState } from "../../src/state";
import { dockerService } from "../../src/services";

describe("DockerPage 工作台", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();

    appState.currentPage = "docker";
    dockerState.pendingAction = null;
    dockerState.target = "";
    dockerState.filters.search = "";
    dockerState.filters.status = "all";
    dockerState.bootstrapped = true;
    dockerState.lastOverviewAt = Date.now();
    dockerState.status = "空闲";
    dockerState.output = "等待执行命令...";
    dockerState.outputDrawerOpen = false;
    dockerState.advancedModeEnabled = false;
    dockerState.dangerConfirm = null;
    dockerState.selected = null;

    dockerState.dashboard.containers = [
      {
        id: "1",
        name: "redis",
        status: "Up 1 minute",
        ports: "6379/tcp",
      },
    ];
    dockerState.dashboard.images = [
      {
        repository: "redis",
        tag: "latest",
        id: "sha256abc123",
        size: "123MB",
      },
    ];
    dockerState.dashboard.stats = [];
    dockerState.dashboard.compose = [];
    dockerState.dashboard.lastCommand = "docker ps";
    dockerState.dashboard.versionText = "Docker version 27.0.0";
    dockerState.dashboard.summary = {
      totalContainers: 1,
      runningContainers: 1,
      totalImages: 1,
      composeProjects: 0,
      totalCpuPercent: 10,
      avgCpuPercent: 10,
      totalMemUsagePercent: 12,
      memUsageText: "128 MiB / 1 GiB",
      netRxText: "1 MiB",
      netTxText: "2 MiB",
    };

    document.body.innerHTML = '<div id="content"></div>';
  });

  it("应渲染双栏工作台结构", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    await page.render(content);

    expect(content.querySelector(".docker-workbench-body")).not.toBeNull();
    expect(content.querySelector(".docker-workbench-left")).not.toBeNull();
    expect(content.querySelector(".docker-workbench-right")).not.toBeNull();
    expect(content.querySelectorAll("[data-docker-select-key]").length).toBeGreaterThan(0);
  });

  it("日志抽屉复制按钮应调用剪贴板 API", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    dockerState.outputDrawerOpen = true;
    dockerState.output = "test-log-content";

    await page.render(content);

    const copyBtn = content.querySelector("[data-docker-copy-output]") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    copyBtn.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("test-log-content");
  });

  it("cleanup 应移除监听并取消防抖", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const runSpy = vi.spyOn(page, "runDockerAction").mockResolvedValue(undefined);
    const updateSpy = vi.spyOn(page, "updatePanelSection");

    await page.render(content);

    const actionBtn = content.querySelector('[data-docker-action="logs"]') as HTMLButtonElement;
    actionBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    const searchInput = content.querySelector("#docker-search") as HTMLInputElement;
    searchInput.value = "redis";
    searchInput.dispatchEvent(new Event("input"));

    page.cleanup();

    actionBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DOCKER_SEARCH_DEBOUNCE_MS + 20);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("高级模式开启后应显示危险操作并可持久化", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    await page.render(content);

    expect(content.querySelector('[data-docker-action="rm"]')).toBeNull();

    const advancedToggle = content.querySelector("#docker-advanced-mode") as HTMLInputElement;
    advancedToggle.checked = true;
    advancedToggle.dispatchEvent(new Event("change"));

    expect(content.querySelector('[data-docker-action="rm"]')).not.toBeNull();
    expect(localStorage.getItem("dev-env-probe-docker-advanced-mode")).toBe("1");
  });

  it("危险操作应要求二次确认", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const runSpy = vi.spyOn(page, "runDockerAction").mockResolvedValue(undefined);

    await page.render(content);

    const advancedToggle = content.querySelector("#docker-advanced-mode") as HTMLInputElement;
    advancedToggle.checked = true;
    advancedToggle.dispatchEvent(new Event("change"));

    const rmBtn = content.querySelector('[data-docker-action="rm"]') as HTMLButtonElement;
    rmBtn.click();
    await Promise.resolve();
    expect(runSpy).not.toHaveBeenCalled();

    rmBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("停止成功后应在 pending 清除后刷新概览", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    dockerState.pendingAction = null;

    await page.render(content);

    const runActionSpy = vi.spyOn(dockerService, "runDockerAction").mockResolvedValue({
      ok: true,
      data: {
        action: "stop",
        command: "docker stop redis",
        stdout: "redis",
        stderr: "",
        exitCode: 0,
      },
      error: null,
      elapsedMs: 30,
    });

    const applySpy = vi.spyOn(dockerService, "applyActionResult").mockImplementation(() => undefined);
    const refreshSpy = vi.spyOn(dockerService, "refreshOverview").mockResolvedValue(undefined);

    await page.runDockerAction("stop", "redis");
    await Promise.resolve();

    expect(runActionSpy).toHaveBeenCalledWith("stop", "redis");
    expect(applySpy).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith("quick");
  });

  it("停止后应优先显示启动操作", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    dockerState.dashboard.containers = [
      {
        id: "1",
        name: "redis",
        status: "Exited (0) 1 second ago",
        ports: "6379/tcp",
      },
    ];

    await page.render(content);

    const startBtn = content.querySelector('[data-docker-action="start"]');
    const stopBtn = content.querySelector('[data-docker-action="stop"]');
    expect(startBtn).not.toBeNull();
    expect(stopBtn).toBeNull();
  });

  it("镜像页应支持一键启动镜像", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const runSpy = vi.spyOn(page, "runDockerAction").mockResolvedValue(undefined);

    dockerState.activeTab = "images";
    dockerState.selected = { kind: "image", key: "sha256abc123" };

    await page.render(content);

    const runBtn = content.querySelector('[data-docker-action="run"]') as HTMLButtonElement;
    expect(runBtn).not.toBeNull();

    runBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledWith("run", "sha256abc123");
  });

  it("状态筛选应使用分段按钮并可切换", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    await page.render(content);

    const runningChip = content.querySelector('[data-docker-status-filter="running"]') as HTMLButtonElement;
    expect(runningChip).not.toBeNull();

    runningChip.click();
    await Promise.resolve();
    expect(dockerState.filters.status).toBe("running");
  });

  it("非加载态且未完成首次概览时应显示占位文案而不是 0", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    dockerState.bootstrapped = true;
    dockerState.lastOverviewAt = 0;
    dockerState.pendingAction = null;
    dockerState.dashboard.containers = [];
    dockerState.dashboard.images = [];
    dockerState.dashboard.stats = [];
    dockerState.dashboard.compose = [];
    dockerState.dashboard.summary = {
      totalContainers: 0,
      runningContainers: 0,
      totalImages: 0,
      composeProjects: 0,
      totalCpuPercent: 0,
      avgCpuPercent: 0,
      totalMemUsagePercent: null,
      memUsageText: "待统计",
      netRxText: "待统计",
      netTxText: "待统计",
    };

    await page.render(content);

    expect(content.textContent).toContain("等待首次概览完成");
    expect(content.textContent).toContain("--");
  });
});
