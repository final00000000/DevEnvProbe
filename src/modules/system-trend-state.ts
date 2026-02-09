import { clampPercent } from "../utils/formatters";

export interface SystemTrendState {
  capacity: number;
  cpuHistory: number[];
  memoryHistory: number[];
  lastUpdatedAt: number;
}

export function createSystemTrendState(capacity = 60): SystemTrendState {
  return {
    capacity,
    cpuHistory: [],
    memoryHistory: [],
    lastUpdatedAt: 0,
  };
}

export function pushSystemTrendPoint(state: SystemTrendState, cpuUsagePercent: number, memoryUsagePercent: number): void {
  state.cpuHistory.push(clampPercent(cpuUsagePercent));
  state.memoryHistory.push(clampPercent(memoryUsagePercent));

  if (state.cpuHistory.length > state.capacity) {
    state.cpuHistory.splice(0, state.cpuHistory.length - state.capacity);
  }

  if (state.memoryHistory.length > state.capacity) {
    state.memoryHistory.splice(0, state.memoryHistory.length - state.capacity);
  }

  state.lastUpdatedAt = Date.now();
}

