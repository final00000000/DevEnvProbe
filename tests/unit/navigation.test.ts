import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initNavigation, resetNavigationRuntimeState, switchPage } from '../../src/core/navigation';
import { NAV_SWITCH_MIN_INTERVAL_MS } from '../../src/constants/config';
import { appState, dockerState, systemState, toolsState } from '../../src/state';

describe('navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <a class="nav-item active" data-page="system"></a>
      <a class="nav-item" data-page="tools"></a>
      <h1 id="page-title"></h1>
      <p id="page-subtitle"></p>
      <div id="content"></div>
    `;

    appState.currentPage = 'system';
    appState.pageRenderEpoch = 0;
    resetNavigationRuntimeState();
    systemState.clearAllTimers();
    toolsState.clearAllTimers();
    dockerState.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initNavigation 应触发页面切换回调', async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    initNavigation(onSwitch);

    const toolsNav = document.querySelector('[data-page="tools"]') as HTMLAnchorElement;
    toolsNav.click();

    expect(onSwitch).toHaveBeenCalledWith('tools');
  });

  it('switchPage 应更新状态并调用页切换回调', async () => {
    const renderCurrentPage = vi.fn().mockResolvedValue(undefined);
    const syncAutoRefresh = vi.fn();
    const onBeforeSwitch = vi.fn();

    await switchPage('tools', renderCurrentPage, syncAutoRefresh, onBeforeSwitch);
    await Promise.resolve();

    expect(appState.currentPage).toBe('tools');
    expect(onBeforeSwitch).toHaveBeenCalledWith('system', 'tools');
    expect(renderCurrentPage).toHaveBeenCalledWith({ allowDomReuse: true });
  });

  it('切页并发时应合并为最新目标页', async () => {
    let resolveRender: (() => void) | null = null;
    const renderCurrentPage = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveRender = resolve;
      })
    );
    const syncAutoRefresh = vi.fn();

    const firstSwitch = switchPage('tools', renderCurrentPage, syncAutoRefresh);
    await Promise.resolve();

    const secondSwitch = switchPage('docker', renderCurrentPage, syncAutoRefresh);
    await Promise.resolve();

    expect(appState.currentPage).toBe('tools');
    expect(renderCurrentPage).toHaveBeenCalledTimes(1);

    resolveRender?.();
    await firstSwitch;
    await secondSwitch;
    await Promise.resolve();

    expect(appState.currentPage).toBe('docker');
    expect(renderCurrentPage).toHaveBeenCalledTimes(2);
  });

  it('频繁切页应被节流并仅执行最后一次目标页', async () => {
    const renderCurrentPage = vi.fn().mockImplementation(async () => {
      appState.incrementRenderEpoch();
    });
    const syncAutoRefresh = vi.fn();

    await switchPage('tools', renderCurrentPage, syncAutoRefresh);
    expect(appState.currentPage).toBe('tools');

    void switchPage('settings', renderCurrentPage, syncAutoRefresh);
    expect(appState.currentPage).toBe('tools');

    await vi.advanceTimersByTimeAsync(NAV_SWITCH_MIN_INTERVAL_MS + 10);

    expect(appState.currentPage).toBe('settings');
    expect(renderCurrentPage).toHaveBeenCalledTimes(2);
  });
});
