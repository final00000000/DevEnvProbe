export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function getBadgeClassByUsage(value: number): string {
  if (value >= 85) {
    return "badge-error";
  }
  if (value >= 70) {
    return "badge-warning";
  }
  return "badge-success";
}

export function getProgressColorClass(value: number): string {
  if (value >= 85) {
    return "bg-error";
  }
  if (value >= 70) {
    return "bg-warning";
  }
  return "bg-success";
}

export function formatGb(value: number): string {
  return `${value.toFixed(2)} GB`;
}

export function formatPercent(value: number, bounded = false): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const displayValue = bounded ? clampPercent(safeValue) : safeValue;
  return `${displayValue.toFixed(1)}%`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "计算中...";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}天`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}小时`);
  }
  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}分`);
  }

  if (parts.length === 0) {
    parts.push(`${secs}秒`);
  }

  return parts.join("");
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
