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

  it('已有仪表盘时全量快照刷新应保持根节点不重建（防闪烁）', async () => {
    const page = new SystemPage();
    const container = document.createElement('div');
    const baseSnapshot = createSnapshot();

    (page as any).renderWithSnapshot(container, baseSnapshot, 10);
    systemState.snapshotCache = baseSnapshot;

    const dashboardBefore = container.querySelector('#system-dashboard');
    expect(dashboardBefore).not.toBeNull();

    vi.spyOn(systemService, 'isSnapshotFresh').mockReturnValue(false);
    vi.spyOn(systemService, 'fetchSystemSnapshot').mockResolvedValue({
      ok: true,
      data: {
        ...baseSnapshot,
        cpuUsagePercent: 47,
        sampledAtMs: Date.now(),
      },
      error: null,
      elapsedMs: 66,
    });

    await page.render(container, 0);

    const dashboardAfter = container.querySelector('#system-dashboard');
    expect(dashboardAfter).toBe(dashboardBefore);
    expect(container.querySelector('.metric-card .metric-value')?.textContent).toContain('47');
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

  it('首次采集失败时应渲染可重试错误态', async () => {
    const page = new SystemPage();
    const container = document.createElement('div');

    vi.spyOn(systemService, 'isSnapshotFresh').mockReturnValue(false);
    vi.spyOn(systemService, 'fetchSystemSnapshot').mockResolvedValue({
      ok: false,
      data: null,
      error: 'snapshot timeout',
      elapsedMs: 2200,
    });

    await page.render(container, 0);

    const bootstrap = container.querySelector('#system-bootstrap-state') as HTMLElement | null;
    expect(bootstrap).not.toBeNull();
    expect(bootstrap?.dataset.bootstrapKind).toBe('error');
    expect(container.querySelector('#system-retry-btn')).not.toBeNull();
    expect(container.textContent).toContain('系统信息获取失败');
  });
});
