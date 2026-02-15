import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPage } from "../../src/pages/docker/DockerPage";
import { appState, deployState, dockerState } from "../../src/state";
import { createDeployProfile, createInitialDeploySteps } from "../../src/modules/deploy";
import { deployService, dockerService } from "../../src/services";

describe("DockerPage 部署流水线区块", () => {
  beforeEach(() => {
    appState.currentPage = "docker";

    dockerState.pendingAction = null;
    dockerState.bootstrapped = true;
    dockerState.lastOverviewAt = Date.now();
    dockerState.status = "空闲";
    dockerState.output = "";
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
    dockerState.dashboard.containers = [];
    dockerState.dashboard.images = [];
    dockerState.dashboard.stats = [];
    dockerState.dashboard.compose = [];

    const profile = createDeployProfile("测试部署");
    profile.git.enabled = false;
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);
    deployState.setSelectedBranch("");
    deployState.setAvailableBranches(["main"]);
    deployState.branchError = null;
    deployState.setAdvancedConfigExpanded(false);
    deployState.setPipeline({
      running: false,
      lastRunAt: 0,
      lastError: null,
      summary: "等待执行部署流程",
      steps: createInitialDeploySteps(),
      logs: [],
    });

    document.body.innerHTML = '<div id="content"></div>';
  });

  it("应渲染部署流水线卡片与主按钮", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    await page.render(content);

    expect(content.textContent).toContain("一键部署流水线");
    expect(content.textContent).toContain("补充工作流");
    expect(content.querySelector('[data-deploy-action="run-start-only"]')).not.toBeNull();
    expect(content.querySelector('[data-deploy-action="run-pull-and-start"]')).not.toBeNull();
  });

  it("应支持高级设置展开与收起", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;

    await page.render(content);

    expect(content.querySelector('[data-deploy-action="toggle-advanced-config"]')).not.toBeNull();
    expect(content.querySelector('[data-deploy-action="choose-compose-project-dir"]')).not.toBeNull();
    const initialPanel = content.querySelector(".deploy-advanced-panel") as HTMLElement;
    expect(initialPanel.classList.contains("hidden")).toBe(true);

    const toggleBtn = content.querySelector('[data-deploy-action="toggle-advanced-config"]') as HTMLButtonElement;
    expect(toggleBtn.textContent).toContain("展开高级设置");

    toggleBtn.click();
    await Promise.resolve();

    const expandedBtn = content.querySelector('[data-deploy-action="toggle-advanced-config"]') as HTMLButtonElement;
    const expandedPanel = content.querySelector(".deploy-advanced-panel") as HTMLElement;
    expect(expandedBtn.textContent).toContain("收起高级设置");
    expect(expandedPanel.classList.contains("hidden")).toBe(false);
  });

  it("项目目录选择按钮应回填 Compose 目录", async () => {
    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const pickSpy = vi.spyOn(deployService, "pickProjectDirectory").mockResolvedValue("D:/workspace/demo");

    await page.render(content);

    await (page as any).pickProjectDirectoryFor("compose.projectPath");

    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(deployState.activeProfile?.compose.projectPath).toBe("D:/workspace/demo");
  });

  it("Run 模式拉取并启动应先弹窗确认，取消后不执行", async () => {
    const profile = createDeployProfile("Run 部署");
    profile.mode = "run";
    profile.git.enabled = false;
    profile.run.containerName = "axonhub-app";
    profile.run.imageSource = "pull";
    profile.run.imageRef = "looplj/axonhub:latest";
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);

    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const orchestratorSpy = vi.spyOn((page as any).deployOrchestrator, "run").mockResolvedValue(deployState.pipeline);

    await page.render(content);

    const runBtn = content.querySelector('[data-deploy-action="run-pull-and-start"]') as HTMLButtonElement;
    runBtn.click();
    await Promise.resolve();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(orchestratorSpy).not.toHaveBeenCalled();
  });

  it("Run 模式确认后应执行拉取并启动流程", async () => {
    const profile = createDeployProfile("Run 部署");
    profile.mode = "run";
    profile.git.enabled = false;
    profile.run.containerName = "axonhub-app";
    profile.run.imageSource = "pull";
    profile.run.imageRef = "looplj/axonhub:latest";
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);

    const successPipeline = {
      running: false,
      lastRunAt: Date.now(),
      lastError: null,
      summary: "部署完成：Run 部署",
      steps: createInitialDeploySteps().map((step) => ({ ...step, status: "success" as const, message: "执行成功" })),
      logs: [],
    };

    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const orchestratorSpy = vi.spyOn((page as any).deployOrchestrator, "run").mockResolvedValue(successPipeline);

    await page.render(content);

    const runBtn = content.querySelector('[data-deploy-action="run-pull-and-start"]') as HTMLButtonElement;
    runBtn.click();
    await Promise.resolve();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(orchestratorSpy).toHaveBeenCalledTimes(1);
  });

  it("Run 模式仅启动应调用 docker start 并跳过确认", async () => {
    const profile = createDeployProfile("Run 仅启动");
    profile.mode = "run";
    profile.git.enabled = false;
    profile.run.containerName = "axonhub-app";
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);

    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const orchestratorSpy = vi.spyOn((page as any).deployOrchestrator, "run").mockResolvedValue(deployState.pipeline);
    const dockerStartSpy = vi.spyOn(dockerService, "runDockerAction").mockResolvedValue({
      ok: true,
      data: {
        action: "start",
        command: "docker start axonhub-app",
        stdout: "axonhub-app",
        stderr: "",
        exitCode: 0,
      },
      error: null,
      elapsedMs: 20,
    });

    await page.render(content);

    const runBtn = content.querySelector('[data-deploy-action="run-start-only"]') as HTMLButtonElement;
    runBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(orchestratorSpy).not.toHaveBeenCalled();
    expect(dockerStartSpy).toHaveBeenCalledWith("start", "axonhub-app");
  });

  it("Run 拉取镜像模式在无项目目录时应自动跳过拉代码", async () => {
    const profile = createDeployProfile("Run 镜像更新");
    profile.mode = "run";
    profile.git.enabled = true;
    profile.run.containerName = "axonhub-app";
    profile.run.imageSource = "pull";
    profile.run.imageRef = "looplj/axonhub:latest";
    profile.run.buildContext = "";
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);
    deployState.setSelectedBranch("");
    deployState.setAvailableBranches(["main"]);

    const successPipeline = {
      running: false,
      lastRunAt: Date.now(),
      lastError: null,
      summary: "部署完成：Run 镜像更新",
      steps: createInitialDeploySteps().map((step) => ({ ...step, status: "success" as const, message: "执行成功" })),
      logs: [],
    };

    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const refreshBranchSpy = vi.spyOn(page as any, "refreshDeployBranches");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const orchestratorSpy = vi.spyOn((page as any).deployOrchestrator, "run").mockResolvedValue(successPipeline);

    await page.render(content);

    const runBtn = content.querySelector('[data-deploy-action="run-pull-and-start"]') as HTMLButtonElement;
    runBtn.click();
    await Promise.resolve();

    expect(refreshBranchSpy).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const [executedProfile, executedBranch] = orchestratorSpy.mock.calls[0];
    expect(executedProfile.git.enabled).toBe(false);
    expect(executedBranch).toBe("");
  });

  it("启用 Git 且未选分支时应自动拉取分支后执行", async () => {
    const profile = createDeployProfile("Compose 部署");
    profile.mode = "compose";
    profile.git.enabled = true;
    profile.compose.projectPath = "D:/workspace/demo";
    profile.compose.composeFile = "docker-compose.yml";
    deployState.setProfiles([profile]);
    deployState.selectProfile(profile.id);
    deployState.setSelectedBranch("");
    deployState.setAvailableBranches([]);

    const successPipeline = {
      running: false,
      lastRunAt: Date.now(),
      lastError: null,
      summary: "部署完成：Compose 部署",
      steps: createInitialDeploySteps().map((step) => ({ ...step, status: "success" as const, message: "执行成功" })),
      logs: [],
    };

    const page = new DockerPage();
    const content = document.getElementById("content") as HTMLElement;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const refreshBranchSpy = vi.spyOn(page as any, "refreshDeployBranches").mockImplementation(async () => {
      deployState.setAvailableBranches(["main", "develop"]);
      deployState.branchError = null;
    });
    const orchestratorSpy = vi.spyOn((page as any).deployOrchestrator, "run").mockResolvedValue(successPipeline);

    await page.render(content);

    const runBtn = content.querySelector('[data-deploy-action="run-pull-and-start"]') as HTMLButtonElement;
    runBtn.click();
    await Promise.resolve();

    expect(refreshBranchSpy).toHaveBeenCalledTimes(1);
    expect(orchestratorSpy).toHaveBeenCalledWith(profile, "main", expect.anything(), expect.any(Function));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
