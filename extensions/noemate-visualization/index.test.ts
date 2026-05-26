import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };

describe("noemate visualization plugin", () => {
  it("is enabled by default", () => {
    expect(manifest.enabledByDefault).toBe(true);
  });

  it("registers the ui artifact tool", () => {
    const registerTool = vi.fn();
    plugin.register(
      createTestPluginApi({
        id: "noemate-visualization",
        name: "NOEMate Visualization",
        registerTool,
      }),
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const names = registerTool.mock.calls.map((call) => call[0]?.name).sort();
    expect(names).toEqual(["ui_artifact"]);
  });
});
