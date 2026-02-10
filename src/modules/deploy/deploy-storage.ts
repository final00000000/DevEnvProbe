import type { DeployProfile } from "../../types";
import { createDeployProfile } from "./deploy-types";
import { normalizeDeployProfile } from "./deploy-validator";

export const DEPLOY_PROFILES_STORAGE_KEY = "dev-env-probe-deploy-profiles-v1";
export const DEPLOY_UI_STORAGE_KEY = "dev-env-probe-deploy-ui-state-v1";

export interface DeployUiStorageState {
  selectedProfileId: string;
  selectedBranch: string;
  advancedConfigExpanded: boolean;
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadDeployProfiles(): DeployProfile[] {
  const parsed = safeJsonParse<unknown[]>(window.localStorage.getItem(DEPLOY_PROFILES_STORAGE_KEY));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [createDeployProfile("默认配置")];
  }

  const profiles = parsed
    .map((item) => normalizeDeployProfile(item))
    .filter((item) => item.id.length > 0);

  if (profiles.length === 0) {
    return [createDeployProfile("默认配置")];
  }

  return profiles;
}

export function saveDeployProfiles(profiles: DeployProfile[]): void {
  const payload = profiles.map((item) => ({
    ...item,
    updatedAt: Date.now(),
  }));

  window.localStorage.setItem(DEPLOY_PROFILES_STORAGE_KEY, JSON.stringify(payload));
}

export function loadDeployUiState(): DeployUiStorageState {
  const parsed = safeJsonParse<Partial<DeployUiStorageState>>(window.localStorage.getItem(DEPLOY_UI_STORAGE_KEY));
  if (!parsed || typeof parsed !== "object") {
    return {
      selectedProfileId: "",
      selectedBranch: "",
      advancedConfigExpanded: false,
    };
  }

  const legacyPanelCollapsed = typeof (parsed as { panelCollapsed?: unknown }).panelCollapsed === "boolean"
    ? ((parsed as { panelCollapsed?: boolean }).panelCollapsed as boolean)
    : null;

  return {
    selectedProfileId: typeof parsed.selectedProfileId === "string" ? parsed.selectedProfileId : "",
    selectedBranch: typeof parsed.selectedBranch === "string" ? parsed.selectedBranch : "",
    advancedConfigExpanded: typeof parsed.advancedConfigExpanded === "boolean"
      ? parsed.advancedConfigExpanded
      : legacyPanelCollapsed === null
        ? false
        : !legacyPanelCollapsed,
  };
}

export function saveDeployUiState(state: DeployUiStorageState): void {
  window.localStorage.setItem(DEPLOY_UI_STORAGE_KEY, JSON.stringify(state));
}
