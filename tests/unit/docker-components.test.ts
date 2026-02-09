import { describe, expect, it } from 'vitest';
import {
  getDockerActionButton,
  getDockerEmptyState,
  getDockerPanelSkeleton,
  getDockerSummarySkeletonCards,
} from '../../src/ui/docker-components';

describe('docker-components', () => {
  it('按钮在空闲状态应可点击', () => {
    const html = getDockerActionButton('ps', '容器列表', { pendingAction: null });
    expect(html).toContain('data-docker-action="ps"');
    expect(html).toContain('容器列表');
    expect(html).not.toContain('disabled');
  });

  it('按钮在运行状态应显示执行中并禁用', () => {
    const html = getDockerActionButton('ps', '容器列表', { pendingAction: 'ps' });
    expect(html).toContain('执行中...');
    expect(html).toContain('disabled');
    expect(html).toContain('is-running');
  });

  it('空状态渲染应包含传入文案', () => {
    const html = getDockerEmptyState('暂无数据');
    expect(html).toContain('暂无数据');
  });

  it('概览骨架卡片应按数量渲染', () => {
    const html = getDockerSummarySkeletonCards(3);
    expect(html.match(/docker-skeleton-card/g)?.length).toBe(3);
    expect(html).toContain('docker-skeleton-line-value');
  });

  it('结构化面板骨架应包含加载提示', () => {
    const html = getDockerPanelSkeleton();
    expect(html).toContain('docker-panel-skeleton');
    expect(html).toContain('正在获取 Docker 概览，请稍候');
  });
});
