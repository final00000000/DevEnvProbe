import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export interface PathValidationResult {
  valid: boolean;
  exists: boolean;
  writable: boolean;
  availableSpaceGb: number | null;
  error: string | null;
}

export interface InstallPathPolicy {
  readonly storageKey: string;
  getDefaultPath(): string;
  setDefaultPath(path: string): void;
  resolveInstallPath(marketInstallPath: string | null | undefined): string | null;
  pickInstallDirectory(): Promise<string | null>;
  validatePath(path: string): Promise<PathValidationResult>;
}

class LocalInstallPathPolicy implements InstallPathPolicy {
  readonly storageKey = "default-install-path";

  getDefaultPath(): string {
    return this.normalizePath(localStorage.getItem(this.storageKey));
  }

  setDefaultPath(path: string): void {
    const normalized = this.normalizePath(path);
    if (!normalized) {
      localStorage.removeItem(this.storageKey);
      return;
    }

    localStorage.setItem(this.storageKey, normalized);
  }

  resolveInstallPath(marketInstallPath: string | null | undefined): string | null {
    // P1: 工具市场显式覆盖
    const explicitOverride = this.normalizePath(marketInstallPath);
    if (explicitOverride) {
      return explicitOverride;
    }

    // P2: 设置页默认路径
    const defaultPath = this.getDefaultPath();
    if (defaultPath) {
      return defaultPath;
    }

    // P3: 系统默认（返回 null）
    return null;
  }

  async pickInstallDirectory(): Promise<string | null> {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "选择安装目录",
    });

    return typeof selectedPath === "string" ? this.normalizePath(selectedPath) || null : null;
  }

  async validatePath(path: string): Promise<PathValidationResult> {
    const response = await invoke<{ ok: boolean; data?: PathValidationResult; error?: string }>(
      "validate_path",
      { path }
    );

    if (!response.ok || !response.data) {
      throw new Error(response.error || "路径校验失败");
    }

    return response.data;
  }

  private normalizePath(value: string | null | undefined): string {
    return (value ?? "").trim();
  }
}

export const installPathPolicy = new LocalInstallPathPolicy();
