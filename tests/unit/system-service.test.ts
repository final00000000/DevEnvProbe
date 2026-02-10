import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemService, SystemService } from '../../src/services/system-service';
import { systemState } from '../../src/state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('SystemService', () => {
  let service: SystemService;

  function createSnapshot(overrides: Record<string, unknown> = {}) {
    return {
      hostName: 'host',
      osName: 'Windows',
      osVersion: '11',
      buildNumber: '1',
      architecture: 'x64',
      uptimeSeconds: 100,
      cpuModel: 'cpu',
      cpuCores: 4,
      cpuLogicalCores: 8,
      cpuUsagePercent: 10,
      totalMemoryGb: 16,
      usedMemoryGb: 4,
      memoryUsagePercent: 25,
      disks: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    service = new SystemService();
    systemState.snapshotCache = null;
    systemState.snapshotLastFetchedAt = 0;
    systemState.trendState.cpuHistory = [];
    systemState.trendState.memoryHistory = [];
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('快照请求应进行 in-flight 去重', async () => {
    const snapshotResponse = {
      ok: true,
      data: createSnapshot(),
      error: null,
      elapsedMs: 120,
    };

    (invoke as any).mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(snapshotResponse), 10);
    }));

    const p1 = service.fetchSystemSnapshot();
    const p2 = service.fetchSystemSnapshot();

    expect(invoke).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20);
    const [result1, result2] = await Promise.all([p1, p2]);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(systemState.snapshotCache).not.toBeNull();
  });

  it('快照超时应回退缓存并标记 stale', async () => {
    systemState.snapshotCache = {
      hostName: 'cache-host',
      osName: 'Windows',
      osVersion: '11',
      buildNumber: '2',
      architecture: 'x64',
      uptimeSeconds: 200,
      cpuModel: 'cache-cpu',
      cpuCores: 8,
      cpuLogicalCores: 16,
      cpuUsagePercent: 20,
      totalMemoryGb: 32,
      usedMemoryGb: 8,
      memoryUsagePercent: 25,
      disks: [],
    } as any;

    (invoke as any).mockImplementation(() => new Promise(() => {
      // 永不返回，触发软超时
    }));

    const promise = service.fetchSystemSnapshot();
    vi.advanceTimersByTime(2500);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.data?.isStale).toBe(true);
  });

  it('实时请求成功应更新趋势数据', async () => {
    (invoke as any).mockResolvedValue({
      ok: true,
      data: {
        uptimeSeconds: 321,
        cpuUsagePercent: 45,
        totalMemoryGb: 16,
        usedMemoryGb: 8,
        memoryUsagePercent: 50,
      },
      error: null,
      elapsedMs: 40,
    });

    const result = await service.fetchSystemRealtime();

    expect(result.ok).toBe(true);
    expect(systemState.trendState.cpuHistory.length).toBe(1);
    expect(systemState.trendState.memoryHistory.length).toBe(1);
  });

  it('快照 invoke 异常时应返回降级结果而不是抛出', async () => {
    (invoke as any).mockRejectedValue(new Error('invoke failed'));

    const result = await service.fetchSystemSnapshot();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('调用异常');
  });

  it('缓存 stale 或关键字段缺失时不应判定为 fresh', () => {
    systemState.snapshotCache = createSnapshot({ isStale: true }) as any;
    systemState.snapshotLastFetchedAt = Date.now();
    expect(service.isSnapshotFresh()).toBe(false);

    systemState.snapshotCache = createSnapshot({
      isStale: false,
      totalMemoryGb: 0,
      cpuCores: 0,
      cpuLogicalCores: 0,
    }) as any;
    systemState.snapshotLastFetchedAt = Date.now();
    expect(service.isSnapshotFresh()).toBe(false);

    systemState.snapshotCache = createSnapshot({ isStale: false }) as any;
    systemState.snapshotLastFetchedAt = Date.now();
    expect(service.isSnapshotFresh()).toBe(true);
  });

  it('运行时长 ticker 应按秒边界触发并可停止', () => {
    const onTick = vi.fn();
    vi.setSystemTime(new Date('2026-02-10T10:00:00.250Z'));

    service.startUptimeTicker(onTick);
    vi.advanceTimersByTime(749);
    expect(onTick).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);

    service.stopUptimeTicker();
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

});

// 保持导入变量被使用（避免 noUnusedLocals）
void systemService;
