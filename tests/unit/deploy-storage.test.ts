import { beforeEach, describe, expect, it } from "vitest";
import {
  DEPLOY_PROFILES_STORAGE_KEY,
  DEPLOY_UI_STORAGE_KEY,
  loadDeployProfiles,
  loadDeployUiState,
  saveDeployProfiles,
  saveDeployUiState,
} from "../../src/modules/deploy";

describe("deploy-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("空存储时应生成默认配置", () => {
    const profiles = loadDeployProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toContain("默认");
  });

  it("应支持配置持久化与恢复", () => {
    const profiles = loadDeployProfiles();
    profiles[0].name = "我的部署";
    profiles[0].compose.projectPath = "D:/workspace/app";
    saveDeployProfiles(profiles);

    const restored = loadDeployProfiles();
    expect(restored[0].name).toBe("我的部署");
    expect(restored[0].compose.projectPath).toBe("D:/workspace/app");
  });

  it("非法 JSON 时应自动回退默认", () => {
    localStorage.setItem(DEPLOY_PROFILES_STORAGE_KEY, "{invalid-json");
    const profiles = loadDeployProfiles();
    expect(profiles.length).toBe(1);
  });

  it("应支持 UI 状态持久化", () => {
    saveDeployUiState({
      selectedProfileId: "p-1",
      selectedBranch: "main",
      advancedConfigExpanded: true,
    });

    const restored = loadDeployUiState();
    expect(restored.selectedProfileId).toBe("p-1");
    expect(restored.selectedBranch).toBe("main");
    expect(restored.advancedConfigExpanded).toBe(true);

    localStorage.setItem(DEPLOY_UI_STORAGE_KEY, "not-json");
    const fallback = loadDeployUiState();
    expect(fallback.selectedProfileId).toBe("");
    expect(fallback.advancedConfigExpanded).toBe(false);
  });

  it("应兼容旧版 panelCollapsed 存储字段", () => {
    localStorage.setItem(
      DEPLOY_UI_STORAGE_KEY,
      JSON.stringify({
        selectedProfileId: "legacy-1",
        selectedBranch: "main",
        panelCollapsed: false,
      })
    );

    const restored = loadDeployUiState();
    expect(restored.selectedProfileId).toBe("legacy-1");
    expect(restored.selectedBranch).toBe("main");
    expect(restored.advancedConfigExpanded).toBe(true);
  });
});
