const DOCKER_ADVANCED_MODE_STORAGE_KEY = "dev-env-probe-docker-advanced-mode";

export function loadDockerAdvancedMode(): boolean {
  try {
    const raw = window.localStorage.getItem(DOCKER_ADVANCED_MODE_STORAGE_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

export function saveDockerAdvancedMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(DOCKER_ADVANCED_MODE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // 忽略持久化异常（如隐私模式）
  }
}

export function getDockerAdvancedModeStorageKey(): string {
  return DOCKER_ADVANCED_MODE_STORAGE_KEY;
}
