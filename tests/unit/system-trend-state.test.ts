import { describe, expect, it } from 'vitest';
import { createSystemTrendState, pushSystemTrendPoint } from '../../src/modules/system-trend-state';

describe('system-trend-state', () => {
  it('应按容量裁剪历史点', () => {
    const state = createSystemTrendState(3);

    pushSystemTrendPoint(state, 10, 20);
    pushSystemTrendPoint(state, 30, 40);
    pushSystemTrendPoint(state, 50, 60);
    pushSystemTrendPoint(state, 70, 80);

    expect(state.cpuHistory).toEqual([30, 50, 70]);
    expect(state.memoryHistory).toEqual([40, 60, 80]);
  });

  it('应更新最后更新时间戳', () => {
    const state = createSystemTrendState(2);
    expect(state.lastUpdatedAt).toBe(0);

    pushSystemTrendPoint(state, 10, 20);
    expect(state.lastUpdatedAt).toBeGreaterThan(0);
  });
});

