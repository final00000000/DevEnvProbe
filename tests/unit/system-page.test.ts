import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemPage } from '../../src/pages/SystemPage';
import { appState, systemState } from '../../src/state';
import { systemService } from '../../src/services';

function createSnapshot() {
  return {
    hostName: 'host',
    osName: 'Windows',
    osVersion: '11',
    buildNumber: '26100',
    architecture: 'x64',
    uptimeSeconds: 120,
    cpuModel: 'Intel',
    cpuCores: 8,
    cpuLogicalCores: 16,
    cpuUsagePercent: 22,
    totalMemoryGb: 32,
    usedMemoryGb: 10,
    memoryUsagePercent: 31.2,
    disks: [],
    sampleMode: 'quick' as const,
    sampledAtMs: Date.now(),
    isStale: false,
  };
}

describe('SystemPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    appState.currentPage = 'system';
    appState.pageRenderEpoch = 0;
    systemState.snapshotCache = null;
    systemState.snapshotLastFetchedAt = 0;
  });

  it('快照缺失关键字段时应显示采集中提示', async () => {
    const page = new SystemPage();
    const container = document.createElement('div');

    vi.spyOn(systemService, 'isSnapshotFresh').mockReturnValue(false);
    vi.spyOn(systemService, 'fetchSystemSnapshot').mockResolvedValue({
      ok: true,
      data: {
        ...createSnapshot(),
        cpuCores: 0,
        cpuLogicalCores: 0,
        totalMemoryGb: 0,
        usedMemoryGb: 0,
        isStale: true,
      },
      error: null,
      elapsedMs: 0,
    });

    await page.render(container, 0);

    expect(container.textContent).toContain('正在获取完整系统信息，请稍候');
    expect(container.textContent).toContain('正在采集中');
  });

  it('局部刷新应更新带 id 的延迟文本', async () => {
    const page = new SystemPage();
    const container = document.createElement('div');
    (page as any).renderWithSnapshot(container, createSnapshot(), 12);

    vi.spyOn(systemService, 'fetchSystemRealtime').mockResolvedValue({
      ok: true,
      data: {
        uptimeSeconds: 180,
        cpuUsagePercent: 35,
        totalMemoryGb: 32,
        usedMemoryGb: 12,
        memoryUsagePercent: 37,
        sampleMode: 'precise',
        sampledAtMs: Date.now(),
        isStale: false,
      },
      error: null,
      elapsedMs: 55,
    });

    await page.refreshPartial(container, 0);

    expect(container.querySelector('#system-snapshot-elapsed')?.textContent).toBe('55ms');
  });

  it('CPU 提示图标点击应弹出说明弹框', async () => {
    const page = new SystemPage();
    const container = document.createElement('div');

    vi.spyOn(systemService, 'isSnapshotFresh').mockReturnValue(false);
    vi.spyOn(systemService, 'fetchSystemSnapshot').mockResolvedValue({
      ok: true,
      data: createSnapshot(),
      error: null,
      elapsedMs: 12,
    });

    await page.render(container, 0);

    const trigger = container.querySelector('[data-cpu-tip-trigger]') as HTMLElement;
    expect(trigger).not.toBeNull();

    trigger.click();

    const modal = document.getElementById('cpu-sampling-modal');
    expect(modal?.classList.contains('is-open')).toBe(true);
  });
});
