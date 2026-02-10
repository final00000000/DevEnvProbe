import { describe, expect, it } from "vitest";
import { formatUptime } from "../../src/utils/formatters";

describe("formatUptime", () => {
  it("应始终包含秒", () => {
    expect(formatUptime(65)).toBe("1分5秒");
    expect(formatUptime(3661)).toBe("1小时1分1秒");
    expect(formatUptime(90061)).toBe("1天1小时1分1秒");
  });

  it("非法值应返回计算中", () => {
    expect(formatUptime(Number.NaN)).toBe("计算中...");
    expect(formatUptime(-1)).toBe("计算中...");
  });
});
