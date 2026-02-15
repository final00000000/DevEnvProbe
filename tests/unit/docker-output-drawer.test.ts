import { describe, expect, it } from "vitest";
import { renderDockerOutputDrawer } from "../../src/modules/docker-workbench/docker-output-drawer";

describe("docker-output-drawer", () => {
  it("有日志时应显示可点击复制按钮", () => {
    const html = renderDockerOutputDrawer({
      open: true,
      status: "成功 · 20ms",
      output: "line1\nline2",
      lastCommand: "docker logs demo",
    });

    expect(html).toContain("data-docker-copy-output");
    expect(html).not.toContain("data-docker-copy-output disabled");
  });

  it("无日志时复制按钮应禁用", () => {
    const html = renderDockerOutputDrawer({
      open: true,
      status: "空闲",
      output: "   ",
      lastCommand: "尚未执行",
    });

    expect(html).toContain("data-docker-copy-output disabled");
  });
});
