import { beforeEach, describe, expect, it } from 'vitest';
import { clearDockerContainerFilterCache, filterDockerContainers } from '../../src/modules/docker-data';

describe('docker-data filter cache', () => {
  beforeEach(() => {
    clearDockerContainerFilterCache();
  });

  it('running 过滤应命中缓存且 clear 后可立即刷新', () => {
    const items = [
      { id: '1', name: 'redis', status: 'Up 1m', ports: '6379/tcp' },
      { id: '2', name: 'nginx', status: 'Exited (0) 1m ago', ports: '80/tcp' },
    ];

    const runningFilters = { search: '', status: 'running' as const };

    const first = filterDockerContainers(items, runningFilters);
    expect(first.map((item) => item.id)).toEqual(['1']);

    items[0].status = 'Exited (137) 1s ago';

    const stale = filterDockerContainers(items, runningFilters);
    expect(stale.map((item) => item.id)).toEqual(['1']);

    clearDockerContainerFilterCache();
    const refreshed = filterDockerContainers(items, runningFilters);
    expect(refreshed).toHaveLength(0);
  });
});

