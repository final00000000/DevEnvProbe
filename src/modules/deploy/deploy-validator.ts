import type { DeployProfile } from "../../types";
import { createDeployProfile, DEPLOY_DEFAULT_PROFILE_NAME, DEPLOY_DEFAULT_REMOTE } from "./deploy-types";

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeDeployProfile(raw: unknown): DeployProfile {
  const defaults = createDeployProfile();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const source = raw as Partial<DeployProfile>;
  const mode = source.mode === "run" ? "run" : "compose";
  const imageSource = source.run?.imageSource === "build" ? "build" : "pull";
  const paramMode = source.run?.paramMode === "template" ? "template" : "form";

  return {
    id: normalizeText(source.id, defaults.id),
    name: normalizeText(source.name, DEPLOY_DEFAULT_PROFILE_NAME),
    mode,
    git: {
      enabled: normalizeBool(source.git?.enabled, true),
      remote: normalizeText(source.git?.remote, DEPLOY_DEFAULT_REMOTE),
    },
    compose: {
      projectPath: normalizeText(source.compose?.projectPath, ""),
      composeFile: normalizeText(source.compose?.composeFile, "docker-compose.yml"),
      service: normalizeText(source.compose?.service, ""),
    },
    run: {
      paramMode,
      containerName: normalizeText(source.run?.containerName, ""),
      imageRef: normalizeText(source.run?.imageRef, ""),
      imageSource,
      buildContext: normalizeText(source.run?.buildContext, ""),
      dockerfile: normalizeText(source.run?.dockerfile, "Dockerfile"),
      imageTag: normalizeText(source.run?.imageTag, ""),
      portsText: normalizeText(source.run?.portsText, ""),
      envText: normalizeText(source.run?.envText, ""),
      volumesText: normalizeText(source.run?.volumesText, ""),
      restartPolicy: normalizeText(source.run?.restartPolicy, "unless-stopped"),
      extraArgs: normalizeText(source.run?.extraArgs, ""),
      templateArgs: normalizeText(source.run?.templateArgs, "-d --name {{CONTAINER}} {{IMAGE}}"),
    },
    createdAt: typeof source.createdAt === "number" ? source.createdAt : defaults.createdAt,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
  };
}

export function validateBranchName(value: string): string | null {
  if (!value.trim()) {
    return "请选择要拉取的分支。";
  }

  if (!/^[\w./-]+$/.test(value.trim())) {
    return "分支名称包含非法字符，请重新选择。";
  }

  return null;
}

export function validateProfileForExecution(profile: DeployProfile, selectedBranch: string): string | null {
  if (!profile.name.trim()) {
    return "部署配置名称不能为空。";
  }

  if (profile.git.enabled) {
    const branchError = validateBranchName(selectedBranch);
    if (branchError) {
      return branchError;
    }

    if (!resolveGitProjectPath(profile)) {
      return "启用拉取代码时，必须提供可用的项目目录。";
    }
  }

  if (profile.mode === "compose") {
    if (!profile.compose.projectPath.trim()) {
      return "Compose 模式需要填写项目目录。";
    }

    if (!profile.compose.composeFile.trim()) {
      return "Compose 模式需要填写 compose 文件路径。";
    }

    return null;
  }

  if (!profile.run.containerName.trim()) {
    return "Run 模式需要填写容器名称。";
  }

  if (profile.run.imageSource === "build") {
    if (!profile.run.buildContext.trim()) {
      return "Run 构建模式需要填写构建上下文目录。";
    }

    if (!profile.run.imageTag.trim()) {
      return "Run 构建模式需要填写镜像 Tag。";
    }
  } else if (!profile.run.imageRef.trim()) {
    return "Run 拉取模式需要填写镜像引用（如 nginx:latest）。";
  }

  if (profile.run.paramMode === "template") {
    if (!profile.run.templateArgs.trim()) {
      return "高级模板参数不能为空。";
    }

    if (!profile.run.templateArgs.includes("{{IMAGE}}")) {
      return "高级模板参数必须包含 {{IMAGE}} 占位符。";
    }

    if (!profile.run.templateArgs.includes("{{CONTAINER}}")) {
      return "高级模板参数必须包含 {{CONTAINER}} 占位符。";
    }
  }

  return null;
}

export function resolveGitProjectPath(profile: DeployProfile): string {
  if (profile.mode === "compose") {
    return profile.compose.projectPath.trim();
  }

  return profile.run.buildContext.trim();
}

export function normalizeMultilineInput(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
