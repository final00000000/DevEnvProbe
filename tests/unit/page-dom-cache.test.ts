import { beforeEach, describe, expect, it } from 'vitest';
import { cachePageRoot, clearPageDomCache, restoreCachedPageRoot } from '../../src/core/page-dom-cache';

describe('page-dom-cache', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearPageDomCache();
  });

  it('应该缓存并恢复 system 页面根节点', () => {
    const container = document.createElement('div');
    container.id = 'content';
    document.body.appendChild(container);

    const root = document.createElement('div');
    root.id = 'system-dashboard';
    container.appendChild(root);

    cachePageRoot('system', container);

    const target = document.createElement('div');
    const restored = restoreCachedPageRoot(target, 'system');
    expect(restored).toBe(true);
    expect(target.firstElementChild?.id).toBe('system-dashboard');
  });

  it('ID 不匹配时不缓存', () => {
    const container = document.createElement('div');
    const root = document.createElement('div');
    root.id = 'wrong-root';
    container.appendChild(root);

    cachePageRoot('system', container);

    const target = document.createElement('div');
    expect(restoreCachedPageRoot(target, 'system')).toBe(false);
  });
});

