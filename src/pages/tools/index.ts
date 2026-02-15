/**
 * ToolsPage 导出
 */

import { ToolsCoordinator } from "./ToolsCoordinator";

export { ToolsRenderer } from "./ToolsRenderer";
export { ToolsController } from "./ToolsController";
export { ToolsCoordinator } from "./ToolsCoordinator";

/**
 * ToolsPage 主类 - 装配器 + 生命周期管理
 */
export class ToolsPage {
  private coordinator = new ToolsCoordinator();

  async render(container: HTMLElement, renderEpoch?: number): Promise<void> {
    await this.coordinator.render(container, renderEpoch);
  }
}

export const toolsPage = new ToolsPage();
