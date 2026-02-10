import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerService } from '../../src/services/docker-service';
import { dockerState } from '../../src/state';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('DockerService', () => {
  let service: DockerService;

  beforeEach(() => {
    service = new DockerService();
    dockerState.pendingAction = null;
    dockerState.status = 'idle';
    dockerState.output = '';
    dockerState.dashboard.containers = [];
    dockerState.dashboard.images = [];
    dockerState.dashboard.stats = [];
    dockerState.dashboard.compose = [];
    dockerState.dashboard.systemDf = '';
    dockerState.dashboard.lastAction = '';
    dockerState.dashboard.lastCommand = '';
    dockerState.lastOverviewAt = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('批量刷新应调用新命令并更新状态', async () => {
    (invoke as any).mockResolvedValue({
      ok: true,
      data: [
        {
          action: 'version',
          command: 'docker --version',
          stdout: 'Docker version 27.0.0',
          stderr: '',
          exitCode: 0,
        },
        {
          action: 'ps',
          command: 'docker ps --format ...',
          stdout: 'CONTAINER ID\tNAMES\tSTATUS\tPORTS\n1\tredis\tUp 1m\t6379/tcp',
          stderr: '',
          exitCode: 0,
        },
      ],
      error: null,
      elapsedMs: 100,
    });

    await service.refreshOverview('quick');

    expect(invoke).toHaveBeenCalledWith('get_docker_overview_batch', { mode: 'quick' });
    expect(dockerState.status).toContain('刷新完成');
    expect(dockerState.dashboard.versionText).toContain('Docker version');
    expect(dockerState.dashboard.containers.length).toBe(1);
  });

  it('批量刷新失败应写入错误状态', async () => {
    (invoke as any).mockResolvedValue({
      ok: false,
      data: null,
      error: 'docker daemon unavailable',
      elapsedMs: 50,
    });

    await service.refreshOverview('quick');

    expect(dockerState.status).toBe('概览刷新失败');
    expect(dockerState.output).toContain('docker daemon unavailable');
  });

  it('应支持 rm/rmi 动作透传', async () => {
    (invoke as any).mockResolvedValue({
      ok: true,
      data: {
        action: 'rm',
        command: 'docker rm redis',
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
      error: null,
      elapsedMs: 30,
    });

    await service.runDockerAction('rm', 'redis');
    expect(invoke).toHaveBeenLastCalledWith('run_docker_action', {
      action: 'rm',
      target: 'redis',
    });

    await service.runDockerAction('rmi', 'sha256abc123');
    expect(invoke).toHaveBeenLastCalledWith('run_docker_action', {
      action: 'rmi',
      target: 'sha256abc123',
    });

    await service.runDockerAction('run', 'sha256abc123');
    expect(invoke).toHaveBeenLastCalledWith('run_docker_action', {
      action: 'run',
      target: 'sha256abc123',
    });
  });
});
