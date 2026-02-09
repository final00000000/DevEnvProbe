/**
 * AppState 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from '../../src/state';

describe('AppState', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
  });

  describe('初始化状态', () => {
    it('应该初始化为 system 页面', () => {
      expect(state.currentPage).toBe('system');
    });

    it('应该初始化渲染版本号为 0', () => {
      expect(state.pageRenderEpoch).toBe(0);
    });
  });

  describe('incrementRenderEpoch()', () => {
    it('应该递增渲染版本号', () => {
      expect(state.incrementRenderEpoch()).toBe(1);
      expect(state.incrementRenderEpoch()).toBe(2);
      expect(state.incrementRenderEpoch()).toBe(3);
    });

    it('应该更新内部状态', () => {
      state.incrementRenderEpoch();
      expect(state.pageRenderEpoch).toBe(1);
    });
  });

  describe('isRenderStale()', () => {
    it('渲染版本号匹配且页面相同时应返回 false', () => {
      state.currentPage = 'system';
      state.pageRenderEpoch = 5;

      expect(state.isRenderStale(5, 'system')).toBe(false);
    });

    it('渲染版本号不匹配时应返回 true', () => {
      state.currentPage = 'system';
      state.pageRenderEpoch = 5;

      expect(state.isRenderStale(4, 'system')).toBe(true);
    });

    it('页面不匹配时应返回 true', () => {
      state.currentPage = 'tools';
      state.pageRenderEpoch = 5;

      expect(state.isRenderStale(5, 'system')).toBe(true);
    });

    it('版本号和页面都不匹配时应返回 true', () => {
      state.currentPage = 'docker';
      state.pageRenderEpoch = 10;

      expect(state.isRenderStale(5, 'tools')).toBe(true);
    });
  });
});

