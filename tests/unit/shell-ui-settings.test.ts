import { describe, expect, it } from "vitest";
import { getSettingsContent } from "../../src/modules/shell-ui";

describe("Settings 页面渲染", () => {
  it("应包含关于区块与更新检查入口", () => {
    const html = getSettingsContent();

    expect(html).toContain("关于");
    expect(html).toContain('id="settings-github-link"');
    expect(html).toContain('id="check-update-btn"');
    expect(html).toContain('id="update-status"');
  });
});
