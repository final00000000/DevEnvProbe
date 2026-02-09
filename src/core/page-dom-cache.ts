import type { PageKey } from "../types";

const pageDomCache = new Map<PageKey, HTMLElement>();

export function cachePageRoot(page: PageKey, container?: HTMLElement | null): void {
  const host = container ?? document.getElementById("content");
  if (!host) {
    return;
  }

  const root = host.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    return;
  }

  if (page === "system" && root.id !== "system-dashboard") {
    return;
  }

  if (page === "tools" && root.id !== "tools-market-root") {
    return;
  }

  pageDomCache.set(page, root);
}

export function restoreCachedPageRoot(container: HTMLElement, page: PageKey): boolean {
  const cachedRoot = pageDomCache.get(page);
  if (!cachedRoot) {
    return false;
  }

  container.replaceChildren(cachedRoot);
  return true;
}

export function clearPageDomCache(page?: PageKey): void {
  if (page) {
    pageDomCache.delete(page);
    return;
  }

  pageDomCache.clear();
}

