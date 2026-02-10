import type { DockerActionType, DockerRiskLevel, DockerSelectionKind } from "../../types";

export interface DockerWorkbenchSelection {
  kind: DockerSelectionKind;
  key: string;
}

export interface DockerWorkbenchActionMeta {
  action: DockerActionType;
  label: string;
  risk: DockerRiskLevel;
  requireTarget: boolean;
  supportKinds: DockerSelectionKind[];
}

export interface DockerWorkbenchActionState {
  disabled: boolean;
  reason: string | null;
  target: string | null;
}
