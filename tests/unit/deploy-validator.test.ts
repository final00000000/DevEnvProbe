import { describe, expect, it } from "vitest";
import { createDeployProfile, normalizeDeployProfile, resolveGitProjectPath, validateProfileForExecution } from "../../src/modules/deploy";

describe("deploy-validator", () => {
  it("应在 compose 缺少目录时返回错误", () => {
    const profile = createDeployProfile("compose");
    profile.mode = "compose";
    profile.git.enabled = true;
    profile.compose.projectPath = "";
    profile.compose.composeFile = "docker-compose.yml";

    const error = validateProfileForExecution(profile, "main");
    expect(error).toContain("项目目录");
  });

  it("模板模式缺少占位符时应返回错误", () => {
    const profile = createDeployProfile("run");
    profile.mode = "run";
    profile.git.enabled = false;
    profile.run.containerName = "demo";
    profile.run.imageSource = "pull";
    profile.run.imageRef = "nginx:latest";
    profile.run.paramMode = "template";
    profile.run.templateArgs = "-d --name demo nginx:latest";

    const error = validateProfileForExecution(profile, "");
    expect(error).toContain("{{IMAGE}}");
  });

  it("normalizeDeployProfile 应修复非法字段", () => {
    const normalized = normalizeDeployProfile({
      id: "abc",
      mode: "invalid",
      run: {
        imageSource: "what",
        paramMode: "noop",
      },
    });

    expect(normalized.mode).toBe("compose");
    expect(normalized.run.imageSource).toBe("pull");
    expect(normalized.run.paramMode).toBe("form");
  });

  it("resolveGitProjectPath 应根据模式返回目录", () => {
    const composeProfile = createDeployProfile("compose");
    composeProfile.mode = "compose";
    composeProfile.compose.projectPath = "D:/workspace/a";
    expect(resolveGitProjectPath(composeProfile)).toBe("D:/workspace/a");

    const runProfile = createDeployProfile("run");
    runProfile.mode = "run";
    runProfile.run.buildContext = "D:/workspace/b";
    expect(resolveGitProjectPath(runProfile)).toBe("D:/workspace/b");
  });
});

