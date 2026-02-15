import type { VersionSourceConfig, UpdateWorkflowConfig } from "../types";

interface ImageVersionConfig {
  imageKey: string;
  sources: VersionSourceConfig[];
  workflow?: UpdateWorkflowConfig;
}

const STORAGE_KEY = "docker_version_configs";

export class VersionConfigStorage {
  getConfig(imageKey: string): ImageVersionConfig | null {
    const configs = this.getAllConfigs();
    return configs[imageKey] || null;
  }

  saveConfig(config: ImageVersionConfig): void {
    const configs = this.getAllConfigs();
    configs[config.imageKey] = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  deleteConfig(imageKey: string): void {
    const configs = this.getAllConfigs();
    delete configs[imageKey];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  private getAllConfigs(): Record<string, ImageVersionConfig> {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  }
}

export const versionConfigStorage = new VersionConfigStorage();
