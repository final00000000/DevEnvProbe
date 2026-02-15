import { invoke } from "@tauri-apps/api/core";
import type {
  CheckImageVersionRequest,
  CheckImageVersionResponse,
  CommandResponse,
  UpdateImageAndRestartRequest,
  UpdateImageAndRestartResponse,
  VersionSourceConfig,
  VersionSourceKind,
} from "../types";

export class DockerVersionService {
  async checkImageVersion(
    imageKey: string,
    sources: VersionSourceConfig[]
  ): Promise<CommandResponse<CheckImageVersionResponse>> {
    const [repository, tag] = imageKey.split(":");
    const request: CheckImageVersionRequest = {
      image: {
        repository: repository || imageKey,
        tag: tag || "latest",
      },
      sources,
    };
    return await invoke<CommandResponse<CheckImageVersionResponse>>(
      "check_image_version",
      { request }
    );
  }

  async updateImageAndRestart(
    imageKey: string,
    targetVersion: string,
    source: VersionSourceKind
  ): Promise<CommandResponse<UpdateImageAndRestartResponse>> {
    const [repository, tag] = imageKey.split(":");
    const request: UpdateImageAndRestartRequest = {
      image: {
        repository: repository || imageKey,
        tag: tag || "latest",
      },
      source,
      targetVersion,
      workflow: {
        gitPullPath: ".",
        gitBranch: "main",
        buildContext: ".",
        dockerfile: "Dockerfile",
        newImageTag: `${repository}:${targetVersion}`,
        runArgs: ["-d", "--name", `${repository}-${targetVersion}`],
      },
      timeouts: {
        gitPullMs: 120000,
        dockerBuildMs: 600000,
        dockerStopMs: 30000,
        dockerRunMs: 60000,
        healthCheckMs: 45000,
      },
      rollback: {
        enabled: true,
        keepBackupMinutes: 30,
      },
    };
    return await invoke<CommandResponse<UpdateImageAndRestartResponse>>(
      "update_image_and_restart",
      { request }
    );
  }
}

export const dockerVersionService = new DockerVersionService();
