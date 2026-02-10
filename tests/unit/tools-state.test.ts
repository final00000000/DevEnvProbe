/**
 * ToolsState 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolsState } from '../../src/state/tools-state';
import type { ToolStatus } from '../../src/types';

describe('ToolsState', () => {
  let state: ToolsState;

  beforeEach(() => {
    state = new ToolsState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('初始化状态', () => {
    it('应该正确初始化所有字段', () => {
      expect(state.dataCache).toEqual([]);
      expect(state.categories).toEqual([]);
      expect(state.filters).toEqual({
        search: '',
        status: 'all',
        category: 'all',
      });
      expect(state.installPath).toBe('');
      expect(state.installingKey).toBeNull();
      expect(state.installLog).toBe('等待安装任务...');
      expect(state.installState).toBe('');
      expect(state.installProgress).toBe(0);
      expect(state.installMessage).toBe('待命中');
      expect(state.installFeedbackLevel).toBe('idle');
      expect(state.installFeedbackTitle).toBe('');
      expect(state.installFeedbackDetail).toBe('');
      expect(state.installProgressTimer).toBeNull();
      expect(state.refreshing).toBe(false);
      expect(state.lastRefreshError).toBeNull();
      expect(state.lastRefreshErrorAt).toBe(0);
      expect(state.refreshFailCount).toBe(0);
      expect(state.scanStartedAt).toBe(0);
      expect(state.scanSoftTimeoutActive).toBe(false);
      expect(state.scanSoftTimeoutMs).toBe(2000);
    });
  });

  describe('appendLog()', () => {
    it('应该追加日志到现有日志', () => {
      state.installLog = '初始日志';
      state.appendLog('新日志行');

      expect(state.installLog).toBe('初始日志\n新日志行');
    });

    it('应该支持多次追加', () => {
      state.appendLog('第一行');
      state.appendLog('第二行');
      state.appendLog('第三行');

      expect(state.installLog).toContain('第一行');
      expect(state.installLog).toContain('第二行');
      expect(state.installLog).toContain('第三行');
    });
  });

  describe('updateCategories()', () => {
    it('应该从工具数据中提取分类', () => {
      state.dataCache = [
        { name: 'Node', category: 'Runtime', installed: true, command: 'node', version: null, details: null, installKey: null },
        { name: 'Git', category: 'VCS', installed: true, command: 'git', version: null, details: null, installKey: null },
        { name: 'Docker', category: 'Container', installed: false, command: 'docker', version: null, details: null, installKey: null },
      ];

      state.updateCategories();

      expect(state.categories).toEqual(['Container', 'Runtime', 'VCS']);
    });

    it('应该去重分类', () => {
      state.dataCache = [
        { name: 'Node', category: 'Runtime', installed: true, command: 'node', version: null, details: null, installKey: null },
        { name: 'Deno', category: 'Runtime', installed: false, command: 'deno', version: null, details: null, installKey: null },
      ];

      state.updateCategories();

      expect(state.categories).toEqual(['Runtime']);
    });

    it('应该按中文排序', () => {
      state.dataCache = [
        { name: 'A', category: '运行时', installed: true, command: 'a', version: null, details: null, installKey: null },
        { name: 'B', category: '编译器', installed: true, command: 'b', version: null, details: null, installKey: null },
        { name: 'C', category: '版本控制', installed: true, command: 'c', version: null, details: null, installKey: null },
      ];

      state.updateCategories();

      expect(state.categories[0]).toBe('版本控制');
      expect(state.categories[1]).toBe('编译器');
      expect(state.categories[2]).toBe('运行时');
    });

    it('当前选中的分类不存在时应重置为 all', () => {
      state.filters.category = 'OldCategory';
      state.dataCache = [
        { name: 'Tool', category: 'NewCategory', installed: true, command: 'tool', version: null, details: null, installKey: null },
      ];

      state.updateCategories();

      expect(state.filters.category).toBe('all');
    });

    it('当前选中的分类存在时应保持不变', () => {
      state.filters.category = 'Runtime';
      state.dataCache = [
        { name: 'Node', category: 'Runtime', installed: true, command: 'node', version: null, details: null, installKey: null },
      ];

      state.updateCategories();

      expect(state.filters.category).toBe('Runtime');
    });
  });

  describe('getToolIdentity()', () => {
    it('应该生成唯一标识', () => {
      const tool: ToolStatus = {
        name: 'Node.js',
        command: 'node',
        category: 'Runtime',
        installed: true,
        version: 'v18.0.0',
        details: null,
        installKey: null,
      };

      expect(state.getToolIdentity(tool)).toBe('Node.js::node');
    });

    it('不同的工具应该有不同的标识', () => {
      const tool1: ToolStatus = {
        name: 'Node',
        command: 'node',
        category: 'Runtime',
        installed: true,
        version: null,
        details: null,
        installKey: null,
      };

      const tool2: ToolStatus = {
        name: 'Node',
        command: 'npm',
        category: 'PackageManager',
        installed: true,
        version: null,
        details: null,
        installKey: null,
      };

      expect(state.getToolIdentity(tool1)).not.toBe(state.getToolIdentity(tool2));
    });
  });

  describe('clearAllTimers()', () => {
    it('应该清除所有定时器', () => {
      state.searchDebounceTimer = window.setTimeout(() => {}, 1000);
      state.autoRefreshTimer = window.setTimeout(() => {}, 2000);
      state.installProgressTimer = window.setTimeout(() => {}, 3000);

      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

      state.clearAllTimers();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
      expect(state.searchDebounceTimer).toBeNull();
      expect(state.autoRefreshTimer).toBeNull();
      expect(state.installProgressTimer).toBeNull();
    });

    it('应该安全处理空定时器', () => {
      state.searchDebounceTimer = null;
      state.autoRefreshTimer = null;
      state.installProgressTimer = null;

      expect(() => state.clearAllTimers()).not.toThrow();
    });
  });
});
