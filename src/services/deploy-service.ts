import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse, DeployStepRequest, DeployStepResult } from "../types";

export class DeployService {
  async listGitBranches(projectPath: string): Promise<CommandResponse<string[]>> {
    return invoke<CommandResponse<string[]>>("list_git_branches", {
      projectPath,
    });
  }

  async executeDeployStep(request: DeployStepRequest): Promise<CommandResponse<DeployStepResult>> {
    return invoke<CommandResponse<DeployStepResult>>("execute_deploy_step", {
      request,
    });
  }

  async pickProjectDirectory(): Promise<string | null> {
    const response = await invoke<CommandResponse<string | null>>("pick_project_directory");
    if (!response.ok || !response.data) {
      return null;
    }

    return response.data;
  }
}

export const deployService = new DeployService();
