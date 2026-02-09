/**
 * 应用常量配置
 */

// ==================== Docker 相关常量 ====================
/** Docker 概览缓存有效期（45秒） */
export const DOCKER_OVERVIEW_REFRESH_TTL_MS = 45_000;

// ==================== System 相关常量 ====================
/** 系统数据刷新间隔（1秒） */
export const SYSTEM_REFRESH_INTERVAL_MS = 1000;

/** 系统快照缓存有效期（15秒） */
export const SYSTEM_SNAPSHOT_TTL_MS = 15000;

/** 系统快照软超时（ms） */
export const SYSTEM_SNAPSHOT_SOFT_TIMEOUT_MS = 2200;

/** 系统实时数据软超时（ms） */
export const SYSTEM_REALTIME_SOFT_TIMEOUT_MS = 1400;

/** 系统趋势数据保留点数（60个点） */
export const SYSTEM_TREND_MAX_POINTS = 60;

// ==================== Tools 相关常量 ====================
/** 工具列表网格批量渲染大小 */
export const TOOLS_GRID_BATCH_SIZE = 12;

/** 工具扫描缓存有效期（2分钟） */
export const TOOLS_CACHE_TTL_MS = 120000;

// ==================== 防抖延迟配置 ====================
/** 工具搜索防抖延迟（ms） */
export const TOOL_SEARCH_DEBOUNCE_MS = 120;

/** Docker 搜索防抖延迟（ms） */
export const DOCKER_SEARCH_DEBOUNCE_MS = 100;

/** 主导航切换最小间隔（ms） */
export const NAV_SWITCH_MIN_INTERVAL_MS = 140;

/** 主导航渲染锁最长等待时间（ms） */
export const NAV_RENDER_LOCK_MAX_MS = 160;

// ==================== 页面恢复配置 ====================
/** 页面恢复刷新延迟（ms） */
export const RESUME_REFRESH_DELAY_MS = 120;

/** 系统页面恢复延迟基准（ms） */
export const SYSTEM_RESUME_DEFER_MS = 320;

// ==================== 渲染优化配置 ====================
/** Docker 初始化延迟（避免阻塞渲染）（ms） */
export const DOCKER_INIT_DELAY_MS = 100;

/** 工具自动刷新调度延迟（ms） */
export const TOOLS_AUTO_REFRESH_DELAY_MS = 260;

/** 系统刷新最小间隔（ms） */
export const SYSTEM_REFRESH_MIN_DELAY_MS = 220;

/** 系统刷新慢调用阈值（ms） */
export const SYSTEM_REFRESH_SLOW_THRESHOLD_MS = 1000;

/** 系统刷新慢调用后的最小间隔（ms） */
export const SYSTEM_REFRESH_SLOW_MIN_DELAY_MS = 3000;

/** 系统恢复暂停最小时长（ms） */
export const SYSTEM_RESUME_MIN_PAUSE_MS = 80;

/** 系统首页首屏加载看门狗时长（ms） */
export const SYSTEM_INITIAL_LOADING_WATCHDOG_MS = 3200;

/** 系统首页首屏自动重试次数 */
export const SYSTEM_INITIAL_LOADING_RETRY_MAX = 1;
