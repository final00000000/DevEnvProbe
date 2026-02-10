import type { DeployPipelineState, DeployProfile } from "../types";
import {
  createDeployProfile,
  createInitialDeploySteps,
  loadDeployProfiles,
  loadDeployUiState,
  normalizeMultilineInput,
  saveDeployProfiles,
  saveDeployUiState,
} from "../modules/deploy";

function createInitialPipelineState(): DeployPipelineState {
  return {
    running: false,
    lastRunAt: 0,
    lastError: null,
    summary: "等待执行部署流程",
    steps: createInitialDeploySteps(),
    logs: [],
  };
}

export class DeployState {
  profiles: DeployProfile[] = [];

  selectedProfileId = "";

  selectedBranch = "";

  advancedConfigExpanded = false;

  availableBranches: string[] = [];

  branchesLoading = false;

  branchError: string | null = null;

  pipeline: DeployPipelineState = createInitialPipelineState();

  constructor() {
    const profiles = loadDeployProfiles();
    const uiState = loadDeployUiState();

    this.profiles = profiles;
    this.selectedProfileId = profiles.some((item) => item.id === uiState.selectedProfileId)
      ? uiState.selectedProfileId
      : profiles[0]?.id ?? "";
    this.selectedBranch = uiState.selectedBranch;
    this.advancedConfigExpanded = uiState.advancedConfigExpanded;
  }

  get activeProfile(): DeployProfile | null {
    return this.profiles.find((item) => item.id === this.selectedProfileId) ?? null;
  }

  setProfiles(next: DeployProfile[]): void {
    this.profiles = next;
    if (!this.profiles.some((item) => item.id === this.selectedProfileId)) {
      this.selectedProfileId = this.profiles[0]?.id ?? "";
    }
    saveDeployProfiles(this.profiles);
    this.persistUiState();
  }

  addProfile(name = "新部署配置"): DeployProfile {
    const profile = createDeployProfile(name);
    this.profiles = [...this.profiles, profile];
    this.selectedProfileId = profile.id;
    saveDeployProfiles(this.profiles);
    this.persistUiState();
    return profile;
  }

  removeActiveProfile(): void {
    if (this.profiles.length <= 1) {
      return;
    }

    this.profiles = this.profiles.filter((item) => item.id !== this.selectedProfileId);
    this.selectedProfileId = this.profiles[0]?.id ?? "";
    saveDeployProfiles(this.profiles);
    this.persistUiState();
  }

  selectProfile(profileId: string): void {
    if (!this.profiles.some((item) => item.id === profileId)) {
      return;
    }
    this.selectedProfileId = profileId;
    this.persistUiState();
  }

  setSelectedBranch(branch: string): void {
    this.selectedBranch = branch;
    this.persistUiState();
  }

  setAdvancedConfigExpanded(expanded: boolean): void {
    this.advancedConfigExpanded = expanded;
    this.persistUiState();
  }

  setAvailableBranches(branches: string[]): void {
    const unique = Array.from(new Set(branches.map((item) => item.trim()).filter((item) => item.length > 0)));
    this.availableBranches = unique;

    if (!this.selectedBranch && unique.length > 0) {
      this.selectedBranch = unique[0];
      this.persistUiState();
      return;
    }

    if (this.selectedBranch && !unique.includes(this.selectedBranch)) {
      this.selectedBranch = unique[0] ?? "";
      this.persistUiState();
    }
  }

  updateActiveProfileField(fieldPath: string, value: string | boolean): void {
    const profile = this.activeProfile;
    if (!profile) {
      return;
    }

    const nextProfile: DeployProfile = {
      ...profile,
      git: { ...profile.git },
      compose: { ...profile.compose },
      run: { ...profile.run },
      updatedAt: Date.now(),
    };

    if (fieldPath === "mode") {
      nextProfile.mode = value === "run" ? "run" : "compose";
    } else if (fieldPath === "name") {
      nextProfile.name = typeof value === "string" ? value : nextProfile.name;
    } else if (fieldPath === "git.enabled") {
      nextProfile.git.enabled = value === true;
    } else if (fieldPath === "git.remote") {
      nextProfile.git.remote = typeof value === "string" ? value : nextProfile.git.remote;
    } else if (fieldPath === "compose.projectPath") {
      nextProfile.compose.projectPath = typeof value === "string" ? value : nextProfile.compose.projectPath;
    } else if (fieldPath === "compose.composeFile") {
      nextProfile.compose.composeFile = typeof value === "string" ? value : nextProfile.compose.composeFile;
    } else if (fieldPath === "compose.service") {
      nextProfile.compose.service = typeof value === "string" ? value : nextProfile.compose.service;
    } else if (fieldPath === "run.paramMode") {
      nextProfile.run.paramMode = value === "template" ? "template" : "form";
    } else if (fieldPath === "run.imageSource") {
      nextProfile.run.imageSource = value === "build" ? "build" : "pull";
    } else if (fieldPath === "run.portsText") {
      nextProfile.run.portsText = typeof value === "string" ? normalizeMultilineInput(value) : nextProfile.run.portsText;
    } else if (fieldPath === "run.envText") {
      nextProfile.run.envText = typeof value === "string" ? normalizeMultilineInput(value) : nextProfile.run.envText;
    } else if (fieldPath === "run.volumesText") {
      nextProfile.run.volumesText = typeof value === "string" ? normalizeMultilineInput(value) : nextProfile.run.volumesText;
    } else if (fieldPath === "run.templateArgs") {
      nextProfile.run.templateArgs = typeof value === "string" ? value.trim() : nextProfile.run.templateArgs;
    } else {
      const runFieldMap = new Set([
        "run.containerName",
        "run.imageRef",
        "run.buildContext",
        "run.dockerfile",
        "run.imageTag",
        "run.restartPolicy",
        "run.extraArgs",
      ]);

      if (runFieldMap.has(fieldPath) && typeof value === "string") {
        const key = fieldPath.replace("run.", "") as keyof DeployProfile["run"];
        (nextProfile.run[key] as string) = value;
      }
    }

    this.profiles = this.profiles.map((item) => (item.id === nextProfile.id ? nextProfile : item));
    saveDeployProfiles(this.profiles);
  }

  resetPipeline(): void {
    this.pipeline = createInitialPipelineState();
  }

  setPipeline(next: DeployPipelineState): void {
    this.pipeline = next;
  }

  private persistUiState(): void {
    saveDeployUiState({
      selectedProfileId: this.selectedProfileId,
      selectedBranch: this.selectedBranch,
      advancedConfigExpanded: this.advancedConfigExpanded,
    });
  }
}

export const deployState = new DeployState();
