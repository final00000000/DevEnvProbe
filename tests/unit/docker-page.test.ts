import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCKER_SEARCH_DEBOUNCE_MS } from '../../src/constants/config';
import { DockerPage } from '../../src/pages/DockerPage';
import { appState, dockerState } from '../../src/state';
import { dockerService } from '../../src/services';

describe('DockerPage cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    appState.currentPage = 'docker';
    dockerState.pendingAction = null;
    dockerState.target = '';
    dockerState.filters.search = '';
    dockerState.filters.status = 'all';
    dockerState.bootstrapped = false;
    dockerState.lastOverviewAt = 0;
    dockerState.dashboard.containers = [];
    dockerState.dashboard.images = [];
    dockerState.dashboard.stats = [];
    dockerState.dashboard.compose = [];

    document.body.innerHTML = `
      <div id="docker-structured-panel"></div>
      <button data-docker-action="ps" data-label="容器列表">容器列表</button>
      <button data-docker-row-action="logs" data-docker-target="redis">日志</button>
      <input id="docker-target" value="" />
      <input id="docker-search" value="" />
      <select id="docker-status-filter">
        <option value="all" selected>all</option>
        <option value="running">running</option>
        <option value="exited">exited</option>
      </select>
      <button data-docker-tab="containers">容器</button>
      <button id="docker-refresh-overview">刷新概览</button>
    `;
  });

  it('cleanup 应移除监听并取消防抖', async () => {
    const page = new DockerPage();
    const runSpy = vi.spyOn(page, 'runDockerAction').mockResolvedValue(undefined);
    const updateSpy = vi.spyOn(page, 'updatePanelSection');

    page.bindDockerActions();

    const actionBtn = document.querySelector('[data-docker-action="ps"]') as HTMLButtonElement;
    actionBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    const searchInput = document.getElementById('docker-search') as HTMLInputElement;
    searchInput.value = 'redis';
    searchInput.dispatchEvent(new Event('input'));

    page.cleanup();

    actionBtn.click();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DOCKER_SEARCH_DEBOUNCE_MS + 20);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('首次渲染应显示骨架并触发概览刷新', async () => {
    document.body.innerHTML = '<div id="content"></div>';
    const content = document.getElementById('content') as HTMLElement;
    const page = new DockerPage();
    const refreshSpy = vi.spyOn(dockerService, 'refreshOverview').mockResolvedValue(undefined);

    await page.render(content);

    expect(content.querySelectorAll('.docker-skeleton-card').length).toBe(5);

    vi.runOnlyPendingTimers();
    await Promise.resolve();

    expect(refreshSpy).toHaveBeenCalledWith('quick');
  });

  it('非加载态且未完成首次概览时应显示占位文案而不是 0', async () => {
    document.body.innerHTML = '<div id="content"></div>';
    const content = document.getElementById('content') as HTMLElement;
    const page = new DockerPage();

    dockerState.bootstrapped = true;
    dockerState.lastOverviewAt = 0;
    dockerState.pendingAction = null;

    await page.render(content);

    expect(content.textContent).toContain('等待首次概览完成');
    expect(content.textContent).toContain('--');
  });
});
