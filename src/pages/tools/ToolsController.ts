/**
 * Tools 页面控制器 - 负责 DOM 事件绑定
 */

import { toolsState } from "../../state";
import { installPathPolicy } from "../../services";
import { TOOL_SEARCH_DEBOUNCE_MS } from "../../constants/config";
import { showGlobalNotice } from "../../modules/shell-ui";
import type { ToolsCoordinator } from "./ToolsCoordinator";

export class ToolsController {
  private gridClickHandler: ((event: Event) => Promise<void>) | null = null;
  private coordinator!: ToolsCoordinator;

  setCoordinator(coordinator: ToolsCoordinator): void {
    this.coordinator = coordinator;
  }

  /**
   * 绑定页面级交互事件
   */
  bindPageActions(): void {
    const searchInput = document.getElementById("tool-search") as HTMLInputElement | null;
    const pathInput = document.getElementById("install-path") as HTMLInputElement | null;
    const refreshBtn = document.getElementById("tools-refresh-btn") as HTMLButtonElement | null;
    const pickPathBtn = document.getElementById("pick-install-path") as HTMLButtonElement | null;

    searchInput?.addEventListener("input", () => {
      toolsState.filters.search = searchInput.value;

      if (toolsState.searchDebounceTimer !== null) {
        window.clearTimeout(toolsState.searchDebounceTimer);
      }

      toolsState.searchDebounceTimer = window.setTimeout(() => {
        toolsState.searchDebounceTimer = null;
        this.coordinator.renderGrid();
      }, TOOL_SEARCH_DEBOUNCE_MS);
    });

    const segment = document.querySelector<HTMLElement>(".filter-segment");
    segment?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-segment-item");
      if (!btn || btn.classList.contains("active")) return;
      const status = btn.dataset.status as typeof toolsState.filters.status;
      if (!status) return;
      toolsState.filters.status = status;
      segment.querySelectorAll(".filter-segment-item").forEach((el) => {
        el.classList.toggle("active", el === btn);
      });
      this.coordinator.renderGrid();
    });

    const chipsContainer = document.querySelector<HTMLElement>(".filter-chips");
    const chipsWrap = document.querySelector<HTMLElement>(".filter-chips-wrap");
    chipsContainer?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-chip");
      if (!btn || btn.classList.contains("active")) return;
      const category = btn.dataset.category;
      if (category === undefined) return;
      toolsState.filters.category = category;
      chipsContainer.querySelectorAll(".filter-chip").forEach((el) => {
        el.classList.toggle("active", el === btn);
      });
      this.coordinator.renderGrid();
    });

    chipsContainer?.addEventListener("scroll", () => {
      if (!chipsContainer || !chipsWrap) return;
      const atEnd = chipsContainer.scrollLeft + chipsContainer.clientWidth >= chipsContainer.scrollWidth - 4;
      chipsWrap.classList.toggle("scrolled-end", atEnd);
    });

    pathInput?.addEventListener("input", () => {
      toolsState.installPath = pathInput.value;
    });

    refreshBtn?.addEventListener("click", async () => {
      if (toolsState.refreshing) {
        showGlobalNotice(
          "探测进行中",
          "当前探测任务正在执行，请稍候...",
          "info",
          2000
        );
        return;
      }

      const contentEl = document.getElementById("content") as HTMLElement | null;
      if (!contentEl) return;

      await this.coordinator.handleRefresh(contentEl);
    });

    pickPathBtn?.addEventListener("click", async () => {
      pickPathBtn.disabled = true;
      try {
        const path = await installPathPolicy.pickInstallDirectory();
        if (path) {
          // 校验路径
          const validation = await installPathPolicy.validatePath(path);
          if (!validation.valid) {
            showGlobalNotice(
              "路径校验失败",
              validation.error || "所选路径无效",
              "error",
              3000
            );
            return;
          }

          toolsState.installPath = path;
          if (pathInput) pathInput.value = path;
        }
      } catch (error) {
        console.error("选择安装目录失败:", error);
        showGlobalNotice(
          "选择目录失败",
          error instanceof Error ? error.message : "无法打开目录选择对话框，请检查权限设置",
          "error",
          3000
        );
      } finally {
        pickPathBtn.disabled = false;
      }
    });
  }

  /**
   * 绑定网格内安装/卸载按钮（事件委托）
   */
  bindGridActions(): void {
    const grid = document.getElementById("tools-grid");
    if (!grid) return;

    if (this.gridClickHandler) {
      grid.removeEventListener("click", this.gridClickHandler);
    }

    this.gridClickHandler = async (event: Event) => {
      const target = event.target as HTMLElement;

      const installButton = target.closest<HTMLButtonElement>("[data-install-key]");
      if (installButton && !installButton.disabled) {
        const key = installButton.dataset.installKey;
        if (key) await this.coordinator.executeToolAction(key, "install");
        return;
      }

      const uninstallButton = target.closest<HTMLButtonElement>("[data-uninstall-key]");
      if (uninstallButton && !uninstallButton.disabled) {
        const key = uninstallButton.dataset.uninstallKey;
        if (key) await this.coordinator.executeToolAction(key, "uninstall");
        return;
      }
    };

    grid.addEventListener("click", this.gridClickHandler);
  }
}

export const toolsController = new ToolsController();
