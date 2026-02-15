import type {
  CheckImageVersionResponse,
  UpdateStepLog,
  VersionSourceKind,
} from "../types";

export interface ImageVersionViewState {
  imageKey: string;
  currentVersion: string | null;
  hasUpdate: boolean;
  recommendedSource: VersionSourceKind | null;
  recommendedVersion: string | null;
  sourceResults: Record<VersionSourceKind, {
    ok: boolean;
    version: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    checkedAtMs: number;
  }>;
  checking: boolean;
  updating: boolean;
  lastOperationId: string | null;
  progressLogs: UpdateStepLog[];
  lastCheckResponse: CheckImageVersionResponse | null;
}

export interface VersionSourceSelectModal {
  open: boolean;
  imageKey: string | null;
  selectedSource: VersionSourceKind | null;
}

export class DockerVersionState {
  byImageKey: Record<string, ImageVersionViewState> = {};
  sourceSelectModal: VersionSourceSelectModal = {
    open: false,
    imageKey: null,
    selectedSource: null,
  };

  getOrCreateImageState(imageKey: string): ImageVersionViewState {
    if (!this.byImageKey[imageKey]) {
      this.byImageKey[imageKey] = {
        imageKey,
        currentVersion: null,
        hasUpdate: false,
        recommendedSource: null,
        recommendedVersion: null,
        sourceResults: {} as any,
        checking: false,
        updating: false,
        lastOperationId: null,
        progressLogs: [],
        lastCheckResponse: null,
      };
    }
    return this.byImageKey[imageKey];
  }

  getCheckResult(imageKey: string): CheckImageVersionResponse | null {
    const state = this.byImageKey[imageKey];
    return state?.lastCheckResponse || null;
  }

  setCheckResult(imageKey: string, response: CheckImageVersionResponse): void {
    this.updateCheckResult(imageKey, response);
  }

  isChecking(imageKey: string): boolean {
    const state = this.byImageKey[imageKey];
    return state?.checking || false;
  }

  isUpdating(imageKey: string): boolean {
    const state = this.byImageKey[imageKey];
    return state?.updating || false;
  }

  setChecking(imageKey: string, checking: boolean): void {
    const state = this.getOrCreateImageState(imageKey);
    state.checking = checking;
  }

  setUpdating(imageKey: string, updating: boolean): void {
    const state = this.getOrCreateImageState(imageKey);
    state.updating = updating;
  }

  updateCheckResult(imageKey: string, response: CheckImageVersionResponse): void {
    const state = this.getOrCreateImageState(imageKey);
    state.lastCheckResponse = response;
    state.currentVersion = response.currentVersion || null;
    state.hasUpdate = response.hasUpdate;
    state.recommendedSource = response.recommended?.source || null;
    state.recommendedVersion = response.recommended?.version || null;

    // Update source results
    const sourceResults: any = {};
    for (const result of response.results) {
      sourceResults[result.source] = {
        ok: result.ok,
        version: result.latest?.version || null,
        errorCode: result.errorCode || null,
        errorMessage: result.errorMessage || null,
        checkedAtMs: response.checkedAtMs,
      };
    }
    state.sourceResults = sourceResults;
  }

  addProgressLog(imageKey: string, log: UpdateStepLog): void {
    const state = this.getOrCreateImageState(imageKey);
    state.progressLogs.push(log);
  }

  clearProgressLogs(imageKey: string): void {
    const state = this.getOrCreateImageState(imageKey);
    state.progressLogs = [];
  }

  setOperationId(imageKey: string, operationId: string): void {
    const state = this.getOrCreateImageState(imageKey);
    state.lastOperationId = operationId;
  }

  openSourceSelectModal(imageKey: string): void {
    this.sourceSelectModal = {
      open: true,
      imageKey,
      selectedSource: null,
    };
  }

  closeSourceSelectModal(): void {
    this.sourceSelectModal = {
      open: false,
      imageKey: null,
      selectedSource: null,
    };
  }

  setSelectedSource(source: VersionSourceKind): void {
    this.sourceSelectModal.selectedSource = source;
  }
}

export const dockerVersionState = new DockerVersionState();
