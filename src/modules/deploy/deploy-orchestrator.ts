import type { CommandResponse, DeployPipelineState, DeployProfile, DeployStep, DeployStepResult } from "../../types";
import { createInitialDeploySteps, DEPLOY_STEP_LABEL, DEPLOY_STEPS } from "./deploy-types";

export interface DeployOrchestratorDeps {
  executeStep: (profile: DeployProfile, step: DeployStep, selectedBranch: string) => Promise<CommandResponse<DeployStepResult>>;
}

function clonePipelineBase(state: DeployPipelineState): DeployPipelineState {
  return {
    ...state,
    running: true,
    lastError: null,
    summary: "部署流程执行中...",
    logs: [],
    steps: createInitialDeploySteps(),
  };
}

function clonePipelineState(state: DeployPipelineState): DeployPipelineState {
  return {
    ...state,
    steps: state.steps.map((item) => ({ ...item })),
    logs: [...state.logs],
  };
}

export class DeployOrchestrator {
  constructor(private readonly deps: DeployOrchestratorDeps) {}

  async run(
    profile: DeployProfile,
    selectedBranch: string,
    currentState: DeployPipelineState,
    onStateChange?: (state: DeployPipelineState) => void
  ): Promise<DeployPipelineState> {
    const nextState = clonePipelineBase(currentState);
    onStateChange?.(clonePipelineState(nextState));

    for (const step of DEPLOY_STEPS) {
      const stepNode = nextState.steps.find((item) => item.step === step);
      if (!stepNode) {
        continue;
      }

      stepNode.status = "running";
      stepNode.message = "执行中...";
      onStateChange?.(clonePipelineState(nextState));

      const response = await this.deps.executeStep(profile, step, selectedBranch);
      if (!response.ok || !response.data) {
        stepNode.status = "failed";
        stepNode.message = response.error ?? "命令执行失败";
        nextState.running = false;
        nextState.lastError = `${DEPLOY_STEP_LABEL[step]}失败：${stepNode.message}`;
        nextState.summary = nextState.lastError;
        nextState.lastRunAt = Date.now();
        onStateChange?.(clonePipelineState(nextState));
        return nextState;
      }

      const result = response.data;
      nextState.logs.push(result);

      if (result.skipped) {
        stepNode.status = "skipped";
        stepNode.message = "已跳过";
        continue;
      }

      if (!result.ok) {
        stepNode.status = "failed";
        stepNode.message = result.error ?? "执行失败";
        nextState.running = false;
        nextState.lastError = `${DEPLOY_STEP_LABEL[step]}失败：${stepNode.message}`;
        nextState.summary = nextState.lastError;
        nextState.lastRunAt = Date.now();
        onStateChange?.(clonePipelineState(nextState));
        return nextState;
      }

      stepNode.status = "success";
      stepNode.message = "执行成功";
      onStateChange?.(clonePipelineState(nextState));
    }

    nextState.running = false;
    nextState.lastRunAt = Date.now();
    nextState.lastError = null;
    nextState.summary = `部署完成：${profile.name}`;
    onStateChange?.(clonePipelineState(nextState));
    return nextState;
  }
}
