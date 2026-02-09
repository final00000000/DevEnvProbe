interface BrowserMemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface MemoryUsageSnapshot {
  used: number;
  total: number;
  limit: number;
  percentage: number;
}

/**
 * 内存监控工具（仅开发模式启用）
 */
export class MemoryMonitor {
  private static instance: MemoryMonitor | null = null;

  private constructor() {}

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }

    return MemoryMonitor.instance;
  }

  getMemoryUsage(): MemoryUsageSnapshot | null {
    const perfMemory = (performance as Performance & { memory?: BrowserMemoryInfo }).memory;
    if (!perfMemory) {
      return null;
    }

    const used = Math.round(perfMemory.usedJSHeapSize / 1024 / 1024);
    const total = Math.round(perfMemory.totalJSHeapSize / 1024 / 1024);
    const limit = Math.round(perfMemory.jsHeapSizeLimit / 1024 / 1024);
    const percentage = perfMemory.totalJSHeapSize > 0
      ? Math.round((perfMemory.usedJSHeapSize / perfMemory.totalJSHeapSize) * 100)
      : 0;

    return {
      used,
      total,
      limit,
      percentage,
    };
  }

  logMemorySnapshot(label: string): void {
    const usage = this.getMemoryUsage();
    if (!usage) {
      return;
    }

    console.log(
      `[Memory] ${label}: ${usage.used}MB / ${usage.total}MB (${usage.percentage}%), limit=${usage.limit}MB`
    );
  }

  checkMemoryThreshold(threshold = 80, label = "memory check"): void {
    const usage = this.getMemoryUsage();
    if (!usage || usage.percentage <= threshold) {
      return;
    }

    console.warn(`[Memory Warning] ${label}: ${usage.percentage}% (${usage.used}MB / ${usage.total}MB)`);
  }

  startMonitoring(intervalMs = 5000): number {
    return window.setInterval(() => {
      this.checkMemoryThreshold(80, "periodic");
    }, intervalMs);
  }

  stopMonitoring(timerId: number): void {
    window.clearInterval(timerId);
  }
}

