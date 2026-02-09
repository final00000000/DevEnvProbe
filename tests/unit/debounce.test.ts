import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../../src/utils/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('高频触发时仅执行最后一次', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 100);

    wrapped('a');
    wrapped('b');
    wrapped('c');

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel 应取消待执行任务', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 120);

    wrapped('payload');
    wrapped.cancel();

    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

