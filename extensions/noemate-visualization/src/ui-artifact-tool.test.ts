import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("materializes an existing htmlPath into the active hosted canvas root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ui-artifact-"));
    try {
      const htmlPath = path.join(root, "index.html");
      await fs.writeFile(htmlPath, "<!doctype html><html><body><h1>Report</h1></body></html>");
      const api = createApi();
      const createCanvasArtifact = api.runtime.richArtifacts.createCanvasArtifact as ReturnType<
        typeof vi.fn
      >;
      const tool = createUiArtifactTool(api);
      const result = await tool.execute("call-2", {
        title: "Weekly Report",
        summaryMarkdown:
          "Top findings in brief.\n\n[Open](/__openclaw__/canvas/documents/ui-report-demo/index.html)",
        htmlPath,
        canvasUrl: "/__openclaw__/canvas/documents/ui-report-demo/index.html",
        preferredHeight: 640,
      });

      expect(createCanvasArtifact).toHaveBeenCalledWith({
        kind: "html_bundle",
        title: "Weekly Report",
        preferredHeight: 640,
        html: "<!doctype html><html><body><h1>Report</h1></body></html>",
        surface: "assistant_message",
      });
      const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
      expect(text).toContain('"id": "cv_ui_report_demo"');
      expect(text).toContain('"/__openclaw__/canvas/documents/cv_ui_report_demo/index.html"');
      expect(text).not.toContain("/__openclaw__/canvas/documents/ui-report-demo/index.html");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("materializes canvas URL placeholders in summary markdown", async () => {
    const tool = createUiArtifactTool(createApi());
    const result = await tool.execute("call-3", {
      title: "Weekly Report",
      summaryMarkdown: "Top findings.\n\n[Open](${CANVAS_URL})",
      canvasUrl: "/__openclaw__/canvas/documents/ui-report-demo/index.html",
      preferredHeight: 640,
    });

    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain(
      '"summary_markdown": "Top findings.\\n\\n[Open](/__openclaw__/canvas/documents/ui-report-demo/index.html)"',
    );
    expect(text).not.toContain("${CANVAS_URL}");
  });

  it("normalizes bare ui-report document urls into hosted canvas urls", async () => {
    const tool = createUiArtifactTool(createApi());
    const result = await tool.execute("call-4", {
      title: "Weekly Report",
      summaryMarkdown: "Top findings.\n\n[Open](http://127.0.0.1:19289/ui-report-demo/index.html)",
      canvasUrl: "http://127.0.0.1:19289/ui-report-demo/index.html",
      preferredHeight: 640,
    });

    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
    expect(text).toContain('"/__openclaw__/canvas/documents/ui-report-demo/index.html"');
    expect(text).toContain(
      '"summary_markdown": "Top findings.\\n\\n[Open](/__openclaw__/canvas/documents/ui-report-demo/index.html)"',
    );
    expect(text).not.toContain("http://127.0.0.1:19289/ui-report-demo/index.html");
  });
});
