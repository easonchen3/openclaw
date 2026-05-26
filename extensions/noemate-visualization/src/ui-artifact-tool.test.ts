import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it, vi } from "vitest";
import { createUiArtifactTool } from "./ui-artifact-tool.js";

function createApi() {
  return createTestPluginApi({
    runtime: {
      richArtifacts: {
        createCanvasArtifact: vi.fn(async () => ({
          manifest: {
            id: "cv_ui_report_demo",
            kind: "html_bundle",
            title: "Weekly Report",
            preferredHeight: 640,
            createdAt: "2026-05-19T00:00:00.000Z",
            entryUrl: "/__openclaw__/canvas/documents/cv_ui_report_demo/index.html",
            localEntrypoint: "index.html",
            surface: "assistant_message",
            assets: [],
          },
          preview: {
            kind: "canvas",
            surface: "assistant_message",
            render: "url",
            viewId: "cv_ui_report_demo",
            url: "/__openclaw__/canvas/documents/cv_ui_report_demo/index.html",
            title: "Weekly Report",
            preferredHeight: 640,
          },
        })),
      },
    } as never,
  });
}

describe("ui_artifact tool", () => {
  it("returns generic ui_artifact payload wrapping a hosted canvas document", async () => {
    const tool = createUiArtifactTool(createApi());
    const result = await tool.execute("call-1", {
      title: "Weekly Report",
      summaryMarkdown: "Top findings in brief.",
      html: "<!doctype html><html><body><h1>Weekly</h1></body></html>",
      preferredHeight: 640,
    });

    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain('"kind": "ui_artifact"');
    expect(text).toContain('"summary_markdown": "Top findings in brief."');
    expect(text).toContain('"placement": "after_markdown"');
    expect(text).toContain('"/__openclaw__/canvas/documents/cv_ui_report_demo/index.html"');
  });

  it("passes through an existing hosted canvas document without creating a new artifact", async () => {
    const api = createApi();
    const createCanvasArtifact = api.runtime.richArtifacts.createCanvasArtifact as ReturnType<
      typeof vi.fn
    >;
    const tool = createUiArtifactTool(api);
    const result = await tool.execute("call-2", {
      title: "Weekly Report",
      summaryMarkdown: "Top findings in brief.",
      htmlPath: "C:\\Users\\test\\.openclaw\\canvas\\documents\\ui-report-demo\\index.html",
      canvasUrl: "/__openclaw__/canvas/documents/ui-report-demo/index.html",
      preferredHeight: 640,
    });

    expect(createCanvasArtifact).not.toHaveBeenCalled();
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain('"id": "ui-report-demo"');
    expect(text).toContain('"/__openclaw__/canvas/documents/ui-report-demo/index.html"');
    expect(text).toContain(
      '"html_path": "C:\\\\Users\\\\test\\\\.openclaw\\\\canvas\\\\documents\\\\ui-report-demo\\\\index.html"',
    );
  });
});
