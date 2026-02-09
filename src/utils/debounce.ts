export type DebouncedFunction<T extends (...args: any[]) => void> = ((...args: Parameters<T>) => void) & {
  cancel: () => void;
};

/**
 * 防抖函数
 * - 高频触发只执行最后一次
 * - 支持 cancel 取消待执行任务，避免页面切换残留回调
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): DebouncedFunction<T> {
  let timer: number | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  }) as DebouncedFunction<T>;

  debounced.cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

