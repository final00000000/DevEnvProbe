import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsService } from '../../src/services/tools-service';
import { toolsState } from '../../src/state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('ToolsService', () => {
  let service: ToolsService;

  beforeEach(() => {
    service = new ToolsService();
    toolsState.dataCache = [];
    toolsState.lastScanAt = 0;
    toolsState.lastScanElapsedMs = 0;
    toolsState.refreshing = false;
    toolsState.diffInstalled = 0;
    toolsState.diffMissing = 0;
    toolsState.categories = [];
    vi.clearAllMocks();
  });

  it('refreshCache 成功后应写入缓存与分类', async () => {
    (invoke as any).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Node', command: 'node', category: 'Runtime', installed: true, version: 'v20', details: null, installKey: null },
        { name: 'Docker', command: 'docker', category: 'Container', installed: false, version: null, details: null, installKey: null },
      ],
      error: null,
      elapsedMs: 180,
    });

    const ok = await service.refreshCache(true);

    expect(ok).toBe(true);
    expect(toolsState.dataCache.length).toBe(2);
    expect(toolsState.categories).toEqual(['Container', 'Runtime']);
    expect(toolsState.lastScanElapsedMs).toBe(180);
  });

  it('refreshing 状态下应直接返回已有缓存结果', async () => {
    toolsState.refreshing = true;
    toolsState.dataCache = [
      { name: 'Node', command: 'node', category: 'Runtime', installed: true, version: 'v20', details: null, installKey: null },
    ] as any;

    const ok = await service.refreshCache(true);
    expect(ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('缓存未过期且非强制刷新时不应重复调用 invoke', async () => {
    toolsState.dataCache = [
      { name: 'Node', command: 'node', category: 'Runtime', installed: true, version: 'v20', details: null, installKey: null },
    ] as any;
    toolsState.lastScanAt = Date.now();

    const ok = await service.refreshCache(false);

    expect(ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

