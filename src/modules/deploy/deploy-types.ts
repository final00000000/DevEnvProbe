import type { DeployPipelineStepState, DeployProfile, DeployStep } from "../../types";

export const DEPLOY_STEPS: DeployStep[] = ["pull_code", "stop_old", "deploy_new"];

export const DEPLOY_STEP_LABEL: Record<DeployStep, string> = {
  pull_code: "拉取代码",
  stop_old: "停止旧容器",
  deploy_new: "部署新版本",
};

export const DEPLOY_DEFAULT_REMOTE = "origin";

export const DEPLOY_DEFAULT_PROFILE_NAME = "未命名部署配置";

export function createDeployProfile(profileName = DEPLOY_DEFAULT_PROFILE_NAME): DeployProfile {
  const now = Date.now();
  const id = `deploy-${now}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: profileName,
    mode: "compose",
    git: {
      enabled: true,
      remote: DEPLOY_DEFAULT_REMOTE,
    },
    compose: {
      projectPath: "",
      composeFile: "docker-compose.yml",
      service: "",
    },
    run: {
      paramMode: "form",
      containerName: "",
      imageRef: "",
      imageSource: "pull",
      buildContext: "",
      dockerfile: "Dockerfile",
      imageTag: "",
      portsText: "",
      envText: "",
      volumesText: "",
      restartPolicy: "unless-stopped",
      extraArgs: "",
      templateArgs: "-d --name {{CONTAINER}} {{IMAGE}}",
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialDeploySteps(): DeployPipelineStepState[] {
  return DEPLOY_STEPS.map((step) => ({
    step,
    status: "pending",
    message: "待执行",
  }));
}

