import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsService } from '../../src/services/tools-service';
import { toolsState } from '../../src/state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('ToolsService', () => {
  let service: ToolsService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new ToolsService();
    toolsState.dataCache = [];
    toolsState.lastScanAt = 0;
    toolsState.lastScanElapsedMs = 0;
    toolsState.refreshing = false;
    toolsState.diffInstalled = 0;
    toolsState.diffMissing = 0;
    toolsState.categories = [];
    toolsState.lastRefreshError = null;
    toolsState.lastRefreshErrorAt = 0;
    toolsState.refreshFailCount = 0;
    toolsState.scanStartedAt = 0;
    toolsState.scanSoftTimeoutActive = false;
    toolsState.scanSoftTimeoutMs = 2000;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
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

  it('并发刷新应复用同一个 in-flight Promise（单飞）', async () => {
    let resolveInvoke!: (value: unknown) => void;
    (invoke as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );

    const firstPromise = service.refreshCacheDetailed(true);
    const secondPromise = service.refreshCacheDetailed(true);

    expect(invoke).toHaveBeenCalledTimes(1);

    resolveInvoke({
      ok: true,
      data: [
        { name: 'Node', command: 'node', category: 'Runtime', installed: true, version: 'v20', details: null, installKey: null },
      ],
      error: null,
      elapsedMs: 100,
    });

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResult).toStrictEqual(secondResult);
    expect(firstResult.ok).toBe(true);
    expect(firstResult.retried).toBe(false);
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

  it('refreshCacheDetailed 在 invoke 异常时应返回失败结果而不抛异常', async () => {
    vi.useFakeTimers();
    (invoke as any).mockRejectedValue(new Error('invoke failed'));

    const resultPromise = service.refreshCacheDetailed(true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('调用异常');
    expect(result.errorType).toBe('fatal');
    expect(result.usedCache).toBe(false);
    expect(result.retried).toBe(true);
    expect(toolsState.refreshFailCount).toBe(1);
    expect(toolsState.lastRefreshError).toContain('调用异常');
  });

  it('refreshCacheDetailed 失败时有缓存应回退缓存并标记 transient', async () => {
    vi.useFakeTimers();
    toolsState.dataCache = [
      { name: 'Node', command: 'node', category: 'Runtime', installed: true, version: 'v20', details: null, installKey: null },
    ] as any;

    (invoke as any).mockResolvedValue({
      ok: false,
      data: null,
      error: 'detect failed',
      elapsedMs: 0,
    });

    const resultPromise = service.refreshCacheDetailed(true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.usedCache).toBe(true);
    expect(result.errorType).toBe('transient');
    expect(result.error).toContain('detect failed');
    expect(toolsState.dataCache.length).toBe(1);
  });

  it('refreshCacheDetailed 失败且无缓存时应标记 fatal', async () => {
    vi.useFakeTimers();
    (invoke as any).mockResolvedValue({
      ok: false,
      data: null,
      error: 'detect failed without cache',
      elapsedMs: 0,
    });

    const resultPromise = service.refreshCacheDetailed(true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.usedCache).toBe(false);
    expect(result.errorType).toBe('fatal');
    expect(result.error).toContain('detect failed without cache');
  });

  it('refreshCacheDetailed 首次失败后重试成功应返回 retried=true 并清理错误状态', async () => {
    vi.useFakeTimers();
    (invoke as any)
      .mockResolvedValueOnce({
        ok: false,
        data: null,
        error: 'first failed',
        elapsedMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { name: 'Docker', command: 'docker', category: 'Container', installed: true, version: 'v24', details: null, installKey: null },
        ],
        error: null,
        elapsedMs: 120,
      });

    const resultPromise = service.refreshCacheDetailed(true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.retried).toBe(true);
    expect(result.error).toBeNull();
    expect(toolsState.lastRefreshError).toBeNull();
    expect(toolsState.refreshFailCount).toBe(0);
    expect(toolsState.dataCache.length).toBe(1);
  });

  it('fetchNpmDownloads 网络超时/异常时不应抛出', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('aborted'));
          }, 3000);
        })
    );

    globalThis.fetch = fetchMock as any;

    const promise = service.fetchNpmDownloads();
    vi.advanceTimersByTime(3200);

    await expect(promise).resolves.toBeUndefined();
  });

  it('refreshCacheDetailed 执行后应记录扫描开始时间并复位软超时标记', async () => {
    toolsState.scanSoftTimeoutActive = true;

    (invoke as any).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Docker', command: 'docker', category: 'Container', installed: true, version: 'v24', details: null, installKey: null },
      ],
      error: null,
      elapsedMs: 88,
    });

    const ok = await service.refreshCacheDetailed(true);

    expect(ok.ok).toBe(true);
    expect(toolsState.scanStartedAt).toBeGreaterThan(0);
    expect(toolsState.scanSoftTimeoutActive).toBe(false);
  });
});
