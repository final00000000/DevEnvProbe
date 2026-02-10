import { describe, expect, it, vi } from "vitest";
import { createDeployProfile } from "../../src/modules/deploy";
import { DeployOrchestrator } from "../../src/modules/deploy/deploy-orchestrator";
import type { CommandResponse, DeployPipelineState, DeployStepResult } from "../../src/types";

function createInitialPipelineState(): DeployPipelineState {
  return {
    running: false,
    lastRunAt: 0,
    lastError: null,
    summary: "",
    logs: [],
    steps: [
      { step: "pull_code", status: "pending", message: "待执行" },
      { step: "stop_old", status: "pending", message: "待执行" },
      { step: "deploy_new", status: "pending", message: "待执行" },
    ],
  };
}

function okStep(step: "pull_code" | "stop_old" | "deploy_new"): CommandResponse<DeployStepResult> {
  return {
    ok: true,
    data: {
      step,
      ok: true,
      skipped: false,
      commands: ["cmd"],
      output: "ok",
      error: null,
      elapsedMs: 10,
    },
    error: null,
    elapsedMs: 10,
  };
}

describe("deploy-orchestrator", () => {
  it("三步成功时应全部通过", async () => {
    const executeStep = vi
      .fn()
      .mockResolvedValueOnce(okStep("pull_code"))
      .mockResolvedValueOnce(okStep("stop_old"))
      .mockResolvedValueOnce(okStep("deploy_new"));

    const orchestrator = new DeployOrchestrator({ executeStep });
    const profile = createDeployProfile("demo");
    const state = await orchestrator.run(profile, "main", createInitialPipelineState());

    expect(executeStep).toHaveBeenCalledTimes(3);
    expect(state.lastError).toBeNull();
    expect(state.steps.every((item) => item.status === "success")).toBe(true);
  });

  it("步骤失败时应立即中断", async () => {
    const executeStep = vi
      .fn()
      .mockResolvedValueOnce(okStep("pull_code"))
      .mockResolvedValueOnce({
        ok: true,
        data: {
          step: "stop_old",
          ok: false,
          skipped: false,
          commands: ["cmd"],
          output: "bad",
          error: "stop failed",
          elapsedMs: 20,
        },
        error: null,
        elapsedMs: 20,
      });

    const orchestrator = new DeployOrchestrator({ executeStep });
    const profile = createDeployProfile("demo");
    const state = await orchestrator.run(profile, "main", createInitialPipelineState());

    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(state.lastError).toContain("失败");
    const deployNewStep = state.steps.find((item) => item.step === "deploy_new");
    expect(deployNewStep?.status).toBe("pending");
  });
});
