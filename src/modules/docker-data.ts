import type {
  DockerComposeItem,
  DockerContainerItem,
  DockerDashboardState,
  DockerFilterState,
  DockerImageItem,
  DockerResourceSummary,
  DockerStatItem,
} from "../types";

const RUNNING_CONTAINER_CACHE_TTL_MS = 3_000;

let cachedRunningContainerIds = new Set<string>();
let cachedRunningContainerSource: DockerContainerItem[] | null = null;
let cachedRunningContainerAtMs = 0;

export function createEmptyDockerState(): DockerDashboardState {
  return {
    containers: [],
    images: [],
    stats: [],
    compose: [],
    summary: createEmptyDockerSummary(),
    rawOutput: "等待执行命令...",
    lastCommand: "",
    lastAction: "",
    systemDf: "",
    infoText: "",
    versionText: "",
  };
}

export function createEmptyDockerSummary(): DockerResourceSummary {
  return {
    totalContainers: 0,
    runningContainers: 0,
    totalImages: 0,
    composeProjects: 0,
    totalCpuPercent: 0,
    avgCpuPercent: 0,
    totalMemUsagePercent: null,
    memUsageText: "待统计",
    netRxText: "待统计",
    netTxText: "待统计",
  };
}

export function buildDockerSummary(state: DockerDashboardState): DockerResourceSummary {
  const totalContainers = state.containers.length;
  const runningContainers = state.containers.filter((item) => isContainerRunning(item.status)).length;
  const totalImages = state.images.length;
  const composeProjects = state.compose.length;
  const totalCpuPercent = state.stats.reduce((sum, item) => sum + item.cpuPercent, 0);
  const avgCpuPercent = state.stats.length > 0 ? totalCpuPercent / state.stats.length : 0;

  const totalMemUsed = state.stats.reduce((sum, item) => sum + (item.memUsedBytes ?? 0), 0);
  const totalMemLimit = state.stats.reduce((sum, item) => sum + (item.memLimitBytes ?? 0), 0);
  const totalMemUsagePercent = totalMemLimit > 0 ? (totalMemUsed / totalMemLimit) * 100 : null;

  const totalRx = state.stats.reduce((sum, item) => sum + item.netRxBytes, 0);
  const totalTx = state.stats.reduce((sum, item) => sum + item.netTxBytes, 0);

  return {
    totalContainers,
    runningContainers,
    totalImages,
    composeProjects,
    totalCpuPercent,
    avgCpuPercent,
    totalMemUsagePercent,
    memUsageText: totalMemLimit > 0 ? `${formatBytes(totalMemUsed)} / ${formatBytes(totalMemLimit)}` : "待统计",
    netRxText: totalRx > 0 ? formatBytes(totalRx) : "待统计",
    netTxText: totalTx > 0 ? formatBytes(totalTx) : "待统计",
  };
}

export function parseDockerContainers(raw: string): DockerContainerItem[] {
  const rows = parseDockerTableRows(raw);
  return rows.map((parts) => {
    const [id = "--", name = "--", status = "--", ...portsParts] = parts;

    return {
      id,
      name,
      status,
      ports: portsParts.join("  ") || "--",
    };
  });
}

export function parseDockerImages(raw: string): DockerImageItem[] {
  const rows = parseDockerTableRows(raw);
  return rows.map((parts) => {
    const [repository = "--", tag = "--", id = "--", ...sizeParts] = parts;

    return {
      repository,
      tag,
      id,
      size: sizeParts.join("  ") || "--",
    };
  });
}

export function parseDockerStats(raw: string): DockerStatItem[] {
  const rows = parseDockerTableRows(raw);

  return rows.map((parts) => {
    const [name = "--", cpuText = "0%", memUsageText = "--", ...netParts] = parts;
    const netIoText = netParts.join("  ") || "--";
    const memory = parseMemoryUsage(memUsageText);
    const network = parseNetworkUsage(netIoText);

    return {
      name,
      cpuPercent: parsePercentValue(cpuText),
      cpuText,
      memUsageText,
      memUsedBytes: memory.usedBytes,
      memLimitBytes: memory.limitBytes,
      memUsagePercent: memory.usagePercent,
      netIoText,
      netRxBytes: network.rxBytes,
      netTxBytes: network.txBytes,
    };
  });
}

export function parseDockerCompose(raw: string): DockerComposeItem[] {
  const rows = parseDockerTableRows(raw);
  return rows.map((parts) => {
    const [name = "--", status = "--", ...configParts] = parts;
    return {
      name,
      status,
      configFiles: configParts.join("  ") || "--",
    };
  });
}

export function filterDockerContainers(items: DockerContainerItem[], filters: DockerFilterState): DockerContainerItem[] {
  ensureRunningContainerCache(items);

  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    const searchMatched =
      search.length === 0 ||
      item.name.toLowerCase().includes(search) ||
      item.id.toLowerCase().includes(search) ||
      item.status.toLowerCase().includes(search) ||
      item.ports.toLowerCase().includes(search);

    if (!searchMatched) {
      return false;
    }

    if (filters.status === "running") {
      return cachedRunningContainerIds.has(item.id);
    }

    if (filters.status === "exited") {
      return !cachedRunningContainerIds.has(item.id);
    }

    return true;
  });
}

export function clearDockerContainerFilterCache(): void {
  cachedRunningContainerIds.clear();
  cachedRunningContainerSource = null;
  cachedRunningContainerAtMs = 0;
}

export function isContainerRunning(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized.includes("up") || normalized.includes("running");
}

function ensureRunningContainerCache(items: DockerContainerItem[]): void {
  const nowMs = Date.now();
  const cacheExpired = nowMs - cachedRunningContainerAtMs > RUNNING_CONTAINER_CACHE_TTL_MS;

  if (!cacheExpired && cachedRunningContainerSource === items) {
    return;
  }

  cachedRunningContainerIds.clear();
  items.forEach((item) => {
    if (isContainerRunning(item.status)) {
      cachedRunningContainerIds.add(item.id);
    }
  });

  cachedRunningContainerSource = items;
  cachedRunningContainerAtMs = nowMs;
}

export function firstMeaningfulLine(raw: string): string | null {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);

  return line ?? null;
}

function parseDockerTableRows(raw: string): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return [];
  }

  return lines
    .slice(1)
    .map(splitDockerColumns)
    .filter((parts) => parts.length > 0);
}

function splitDockerColumns(line: string): string[] {
  const tabParts = line
    .split("\t")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (tabParts.length > 1) {
    return tabParts;
  }

  return line
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parsePercentValue(text: string): number {
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return 0;
  }

  return Number.parseFloat(match[0]);
}

function parseMemoryUsage(text: string): { usedBytes: number | null; limitBytes: number | null; usagePercent: number | null } {
  const [usedRaw, limitRaw] = text.split("/").map((part) => part.trim());
  if (!usedRaw || !limitRaw) {
    return { usedBytes: null, limitBytes: null, usagePercent: null };
  }

  const usedBytes = parseSizeToBytes(usedRaw);
  const limitBytes = parseSizeToBytes(limitRaw);

  if (usedBytes === null || limitBytes === null || limitBytes <= 0) {
    return { usedBytes, limitBytes, usagePercent: null };
  }

  return {
    usedBytes,
    limitBytes,
    usagePercent: (usedBytes / limitBytes) * 100,
  };
}

function parseNetworkUsage(text: string): { rxBytes: number; txBytes: number } {
  const [rxRaw, txRaw] = text.split("/").map((part) => part.trim());
  const rxBytes = parseSizeToBytes(rxRaw) ?? 0;
  const txBytes = parseSizeToBytes(txRaw) ?? 0;

  return {
    rxBytes,
    txBytes,
  };
}

function parseSizeToBytes(raw: string): number | null {
  const normalized = raw.replace(/\s+/g, "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^([\d.]+)([a-zA-Z]+)?$/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  const unitRaw = (match[2] ?? "B").toLowerCase();
  if (unitRaw === "b") {
    return value;
  }

  const binaryMap: Record<string, number> = {
    kib: 1,
    mib: 2,
    gib: 3,
    tib: 4,
    pib: 5,
    eib: 6,
  };

  const decimalMap: Record<string, number> = {
    kb: 1,
    mb: 2,
    gb: 3,
    tb: 4,
    pb: 5,
    eb: 6,
  };

  if (unitRaw in binaryMap) {
    return value * 1024 ** binaryMap[unitRaw];
  }

  if (unitRaw in decimalMap) {
    return value * 1000 ** decimalMap[unitRaw];
  }

  return null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
