import type { DockerActionType, DockerSelectionKind } from "../../types";
import type { DockerWorkbenchActionMeta, DockerWorkbenchActionState } from "./docker-workbench-types";

const DOCKER_ACTION_META_LIST: DockerWorkbenchActionMeta[] = [
  {
    action: "run",
    label: "启动镜像",
    risk: "safe",
    requireTarget: true,
    supportKinds: ["image"],
  },
  {
    action: "start",
    label: "启动",
    risk: "safe",
    requireTarget: true,
    supportKinds: ["container"],
  },
  {
    action: "stop",
    label: "停止",
    risk: "safe",
    requireTarget: true,
    supportKinds: ["container"],
  },
  {
    action: "restart",
    label: "重启",
    risk: "safe",
    requireTarget: true,
    supportKinds: ["container"],
  },
  {
    action: "logs",
    label: "日志",
    risk: "safe",
    requireTarget: true,
    supportKinds: ["container"],
  },
  {
    action: "rm",
    label: "删除容器",
    risk: "danger",
    requireTarget: true,
    supportKinds: ["container"],
  },
  {
    action: "rmi",
    label: "删除镜像",
    risk: "danger",
    requireTarget: true,
    supportKinds: ["image"],
  },
];

const DOCKER_ACTION_META_MAP = new Map<DockerActionType, DockerWorkbenchActionMeta>(
  DOCKER_ACTION_META_LIST.map((item) => [item.action, item])
);

export const SAFE_DOCKER_ACTIONS: DockerActionType[] = ["run", "start", "stop", "restart", "logs"];

export const DANGER_DOCKER_ACTIONS: DockerActionType[] = ["rm", "rmi"];

export function getDockerActionMeta(action: DockerActionType): DockerWorkbenchActionMeta | undefined {
  return DOCKER_ACTION_META_MAP.get(action);
}

export function getDockerActionLabel(action: DockerActionType): string {
  return DOCKER_ACTION_META_MAP.get(action)?.label ?? action;
}

export function isDangerDockerAction(action: DockerActionType): boolean {
  return DANGER_DOCKER_ACTIONS.includes(action);
}

export function resolveDockerActionState(
  action: DockerActionType,
  selectionKind: DockerSelectionKind | null,
  target: string | null,
  pendingAction: string | null
): DockerWorkbenchActionState {
  const meta = getDockerActionMeta(action);
  if (!meta) {
    return {
      disabled: true,
      reason: "未支持的动作",
      target,
    };
  }

  if (pendingAction !== null) {
    return {
      disabled: true,
      reason: "命令执行中",
      target,
    };
  }

  if (!selectionKind || !meta.supportKinds.includes(selectionKind)) {
    return {
      disabled: true,
      reason: "当前选中对象不支持该操作",
      target,
    };
  }

  if (meta.requireTarget && (!target || target.length === 0)) {
    return {
      disabled: true,
      reason: "目标无效",
      target,
    };
  }

  return {
    disabled: false,
    reason: null,
    target,
  };
}
