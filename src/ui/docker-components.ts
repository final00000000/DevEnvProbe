/**
 * Docker UI 组件
 */

import { escapeHtml } from "../utils/formatters";

export interface DockerActionButtonOptions {
  pendingAction: string | null;
}

/**
 * 生成 Docker 操作按钮
 */
export function getDockerActionButton(action: string, label: string, options: DockerActionButtonOptions): string {
  const isBusy = options.pendingAction !== null;
  const isRunning = options.pendingAction === action;

  return `
    <button
      class="btn btn-secondary docker-action-btn ${isRunning ? "is-running" : ""}"
      data-docker-action="${action}"
      data-label="${label}"
      ${isBusy ? "disabled" : ""}
    >
      ${isRunning ? "执行中..." : label}
    </button>
  `;
}

/**
 * 生成 Docker 空状态提示
 */
export function getDockerEmptyState(message: string): string {
  return `<div class="docker-empty">${escapeHtml(message)}</div>`;
}

/**
 * 生成 Docker 加载状态
 */
export function getDockerLoadingState(): string {
  return `
    <div class="docker-loading-state">
      <div class="docker-loading-spinner">
        <svg class="docker-spinner-icon" viewBox="0 0 50 50">
          <circle class="docker-spinner-path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
        </svg>
      </div>
      <div class="docker-loading-text">正在加载 Docker 数据...</div>
      <div class="docker-loading-hint">首次加载可能需要几秒钟</div>
    </div>
  `;
}

/**
 * 生成 Docker 概览骨架卡片
 */
export function getDockerSummarySkeletonCards(count: number = 5): string {
  return Array.from({ length: count }, () => {
    return `
      <div class="card metric-card docker-skeleton-card animate-fade-in" aria-hidden="true">
        <div class="docker-skeleton-line docker-skeleton-line-title"></div>
        <div class="docker-skeleton-line docker-skeleton-line-value"></div>
        <div class="docker-skeleton-line docker-skeleton-line-subtitle"></div>
      </div>
    `;
  }).join("");
}

/**
 * 生成 Docker 结构化面板骨架
 */
export function getDockerPanelSkeleton(): string {
  return `
    <div class="docker-panel-skeleton" role="status" aria-live="polite">
      <div class="docker-skeleton-row">
        <div class="docker-skeleton-line docker-skeleton-line-wide"></div>
        <div class="docker-skeleton-line docker-skeleton-line-short"></div>
      </div>
      <div class="docker-skeleton-row">
        <div class="docker-skeleton-line docker-skeleton-line-wide"></div>
        <div class="docker-skeleton-line docker-skeleton-line-short"></div>
      </div>
      <div class="docker-skeleton-row">
        <div class="docker-skeleton-line docker-skeleton-line-wide"></div>
        <div class="docker-skeleton-line docker-skeleton-line-short"></div>
      </div>
      <div class="docker-loading-hint">正在获取 Docker 概览，请稍候...</div>
    </div>
  `;
}
