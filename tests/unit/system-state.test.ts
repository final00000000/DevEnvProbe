/**
 * SystemState 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SystemState } from '../../src/state/system-state';

describe('SystemState', () => {
  let state: SystemState;

  beforeEach(() => {
    state = new SystemState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('初始化状态', () => {
    it('应该正确初始化所有字段', () => {
      expect(state.snapshotCache).toBeNull();
      expect(state.refreshLoopActive).toBe(false);
      expect(state.refreshInFlight).toBe(false);
      expect(state.appIsVisible).toBe(true);
      expect(state.uptimeAnchorSeconds).toBe(0);
      expect(state.uptimeAnchorAtMs).toBe(0);
    });

    it('应该创建趋势状态', () => {
      expect(state.trendState).toBeDefined();
      expect(state.trendState.capacity).toBe(60);
    });
  });

  describe('updateUptimeAnchor()', () => {
    it('应该更新运行时长锚点', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      state.updateUptimeAnchor(12345);

      expect(state.uptimeAnchorSeconds).toBe(12345);
      expect(state.uptimeAnchorAtMs).toBe(now);
    });

    it('应该向下取整秒数', () => {
      state.updateUptimeAnchor(123.89);
      expect(state.uptimeAnchorSeconds).toBe(123);
    });

    it('应该处理负数为 0', () => {
      state.updateUptimeAnchor(-100);
      expect(state.uptimeAnchorSeconds).toBe(0);
    });

    it('已有有效运行时长时应忽略 0 覆盖', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      state.updateUptimeAnchor(3600);
      const anchorAt = state.uptimeAnchorAtMs;

      vi.setSystemTime(now + 1000);
      state.updateUptimeAnchor(0);

      expect(state.uptimeAnchorSeconds).toBe(3600);
      expect(state.uptimeAnchorAtMs).toBe(anchorAt);
    });
  });

  describe('getAnchoredUptimeSeconds()', () => {
    it('锚点未设置时应返回锚点秒数', () => {
      state.uptimeAnchorSeconds = 100;
      state.uptimeAnchorAtMs = 0;

      expect(state.getAnchoredUptimeSeconds()).toBe(100);
    });

    it('应该根据时间流逝计算运行时长', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      state.uptimeAnchorSeconds = 1000;
      state.uptimeAnchorAtMs = now;

      // 前进 5 秒
      vi.setSystemTime(now + 5000);

      expect(state.getAnchoredUptimeSeconds()).toBe(1005);
    });

    it('应该处理负数差值为 0', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      state.uptimeAnchorSeconds = 1000;
      state.uptimeAnchorAtMs = now + 10000; // 未来时间

      expect(state.getAnchoredUptimeSeconds()).toBe(1000);
    });
  });

  describe('clearAllTimers()', () => {
    it('应该清除所有定时器', () => {
      // 设置定时器
      state.refreshLoopTimer = window.setTimeout(() => {}, 1000);
      state.uptimeTickTimer = window.setInterval(() => {}, 1000);
      state.resumeRefreshTimer = window.setTimeout(() => {}, 1000);
      state.refreshLoopActive = true;

      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      state.clearAllTimers();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(state.refreshLoopTimer).toBeNull();
      expect(state.uptimeTickTimer).toBeNull();
      expect(state.resumeRefreshTimer).toBeNull();
      expect(state.refreshLoopActive).toBe(false);
    });

    it('应该安全处理空定时器', () => {
      state.refreshLoopTimer = null;
      state.uptimeTickTimer = null;
      state.resumeRefreshTimer = null;

      expect(() => state.clearAllTimers()).not.toThrow();
    });
  });
});
