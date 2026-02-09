export interface PageConfig {
  title: string;
  subtitle: string;
}

export interface CommandResponse<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  elapsedMs: number;
}

export interface DiskSnapshot {
  name: string;
  mountPoint: string;
  totalGb: number;
  usedGb: number;
  usagePercent: number;
}

export interface SystemSnapshot {
  hostName: string;
  osName: string;
  osVersion: string;
  buildNumber: string;
  architecture: string;
  uptimeSeconds: number;
  cpuModel: string;
  cpuCores: number;
  cpuLogicalCores: number;
  cpuUsagePercent: number;
  totalMemoryGb: number;
  usedMemoryGb: number;
  memoryUsagePercent: number;
  disks: DiskSnapshot[];
}

export interface SystemRealtimeSnapshot {
  uptimeSeconds: number;
  cpuUsagePercent: number;
  totalMemoryGb: number;
  usedMemoryGb: number;
  memoryUsagePercent: number;
}

export interface ToolStatus {
  name: string;
  command: string;
  category: string;
  installed: boolean;
  version: string | null;
  details: string | null;
  installKey: string | null;
}

export interface DockerCommandResult {
  action: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerContainerItem {
  id: string;
  name: string;
  status: string;
  ports: string;
}

export interface DockerImageItem {
  repository: string;
  tag: string;
  id: string;
  size: string;
}

export interface DockerStatItem {
  name: string;
  cpuPercent: number;
  cpuText: string;
  memUsageText: string;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  memUsagePercent: number | null;
  netIoText: string;
  netRxBytes: number;
  netTxBytes: number;
}

export interface DockerComposeItem {
  name: string;
  status: string;
  configFiles: string;
}

export interface DockerResourceSummary {
  totalContainers: number;
  runningContainers: number;
  totalImages: number;
  composeProjects: number;
  totalCpuPercent: number;
  avgCpuPercent: number;
  totalMemUsagePercent: number | null;
  memUsageText: string;
  netRxText: string;
  netTxText: string;
}

export interface DockerFilterState {
  search: string;
  status: "all" | "running" | "exited";
}

export type DockerPanelTab = "containers" | "images" | "stats" | "compose";

export interface DockerDashboardState {
  containers: DockerContainerItem[];
  images: DockerImageItem[];
  stats: DockerStatItem[];
  compose: DockerComposeItem[];
  summary: DockerResourceSummary;
  rawOutput: string;
  lastCommand: string;
  lastAction: string;
  systemDf: string;
  infoText: string;
  versionText: string;
}

export interface InstallResult {
  itemKey: string;
  packageId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ToolFilterState {
  search: string;
  status: "all" | "installed" | "missing";
  category: string;
}

export interface MarketMeta {
  title: string;
  description: string;
  tags: string[];
  hot: string;
  downloads: string;
  type: string;
}

export type PageKey = "system" | "tools" | "docker" | "settings";
