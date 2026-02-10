import type {
  DockerActionType,
  DockerComposeItem,
  DockerContainerItem,
  DockerDashboardState,
  DockerFilterState,
  DockerImageItem,
  DockerPanelTab,
  DockerSelectionKind,
  DockerStatItem,
} from "../../types";
import { filterDockerContainers } from "../docker-data";
import type { DockerWorkbenchSelection } from "./docker-workbench-types";

export interface DockerSelectionEntry {
  kind: DockerSelectionKind;
  key: string;
  title: string;
  subtitle: string;
  target: string | null;
}

export function getSelectionKindByTab(tab: DockerPanelTab): DockerSelectionKind {
  switch (tab) {
    case "containers":
      return "container";
    case "images":
      return "image";
    case "stats":
      return "stat";
    case "compose":
      return "compose";
    default:
      return "container";
  }
}

export function getSelectionEntries(
  tab: DockerPanelTab,
  dashboard: DockerDashboardState,
  filters: DockerFilterState
): DockerSelectionEntry[] {
  switch (tab) {
    case "containers":
      return buildContainerEntries(dashboard.containers, filters);
    case "images":
      return buildImageEntries(dashboard.images, filters.search);
    case "stats":
      return buildStatsEntries(dashboard.stats, filters.search);
    case "compose":
      return buildComposeEntries(dashboard.compose, filters.search);
    default:
      return [];
  }
}

export function normalizeWorkbenchSelection(
  tab: DockerPanelTab,
  dashboard: DockerDashboardState,
  filters: DockerFilterState,
  current: DockerWorkbenchSelection | null
): DockerWorkbenchSelection | null {
  const entries = getSelectionEntries(tab, dashboard, filters);
  if (entries.length === 0) {
    return null;
  }

  const kind = getSelectionKindByTab(tab);
  if (current && current.kind === kind && entries.some((entry) => entry.key === current.key)) {
    return current;
  }

  return {
    kind,
    key: entries[0].key,
  };
}

export function findSelectionEntry(
  tab: DockerPanelTab,
  dashboard: DockerDashboardState,
  filters: DockerFilterState,
  selection: DockerWorkbenchSelection | null
): DockerSelectionEntry | null {
  if (!selection) {
    return null;
  }

  const entries = getSelectionEntries(tab, dashboard, filters);
  return entries.find((entry) => entry.kind === selection.kind && entry.key === selection.key) ?? null;
}

export function resolveActionTarget(
  action: DockerActionType,
  tab: DockerPanelTab,
  dashboard: DockerDashboardState,
  filters: DockerFilterState,
  selection: DockerWorkbenchSelection | null
): string | null {
  const entry = findSelectionEntry(tab, dashboard, filters, selection);
  if (!entry) {
    return null;
  }

  if (action === "rmi" || action === "run") {
    return entry.kind === "image" ? entry.target : null;
  }

  if (action === "rm" || action === "start" || action === "stop" || action === "restart" || action === "logs") {
    return entry.kind === "container" ? entry.target : null;
  }

  return entry.target;
}

function buildContainerEntries(items: DockerContainerItem[], filters: DockerFilterState): DockerSelectionEntry[] {
  return filterDockerContainers(items, filters).map((item) => ({
    kind: "container",
    key: item.id,
    title: item.name,
    subtitle: item.status,
    target: item.name,
  }));
}

function buildImageEntries(items: DockerImageItem[], search: string): DockerSelectionEntry[] {
  const normalizedSearch = search.trim().toLowerCase();
  return items
    .filter((item) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        item.repository.toLowerCase().includes(normalizedSearch) ||
        item.tag.toLowerCase().includes(normalizedSearch) ||
        item.id.toLowerCase().includes(normalizedSearch)
      );
    })
    .map((item) => ({
      kind: "image",
      key: item.id,
      title: `${item.repository}:${item.tag}`,
      subtitle: `${item.size} · ${item.id}`,
      target: normalizeDockerImageTarget(item.id),
    }));
}

function buildStatsEntries(items: DockerStatItem[], search: string): DockerSelectionEntry[] {
  const normalizedSearch = search.trim().toLowerCase();
  return items
    .filter((item) => (normalizedSearch ? item.name.toLowerCase().includes(normalizedSearch) : true))
    .map((item) => ({
      kind: "stat",
      key: item.name,
      title: item.name,
      subtitle: `CPU ${item.cpuText} · MEM ${item.memUsageText}`,
      target: null,
    }));
}

function buildComposeEntries(items: DockerComposeItem[], search: string): DockerSelectionEntry[] {
  const normalizedSearch = search.trim().toLowerCase();
  return items
    .filter((item) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        item.name.toLowerCase().includes(normalizedSearch) ||
        item.status.toLowerCase().includes(normalizedSearch) ||
        item.configFiles.toLowerCase().includes(normalizedSearch)
      );
    })
    .map((item) => ({
      kind: "compose",
      key: item.name,
      title: item.name,
      subtitle: item.status,
      target: null,
    }));
}

function normalizeDockerImageTarget(rawId: string): string | null {
  const trimmed = rawId.trim();
  if (!trimmed || trimmed === "--") {
    return null;
  }

  const normalized = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "");
}
