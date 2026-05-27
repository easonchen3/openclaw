import { describe, expect, it } from "vitest";
import { extractCanvasFromText } from "./canvas-render.js";

describe("extractCanvasFromText", () => {
  it("coerces ui_artifact payloads into assistant canvas previews", () => {
    const preview = extractCanvasFromText(
      JSON.stringify({
        kind: "ui_artifact",
        summary_markdown: "HTR TPS trend report",
        artifact: {
          backend: "canvas",
          id: "ui-report-demo",
          url: "/__openclaw__/canvas/documents/ui-report-demo/index.html",
          title: "HTR TPS 趋势报告",
          preferred_height: 620,
        },
        presentation: {
          target: "assistant_message",
          layout: "companion",
          placement: "after_markdown",
        },
      }),
    );

    expect(preview).toEqual({
      kind: "canvas",
      surface: "assistant_message",
      render: "url",
      viewId: "ui-report-demo",
      url: "/__openclaw__/canvas/documents/ui-report-demo/index.html",
      title: "HTR TPS 趋势报告",
      preferredHeight: 620,
    });
  });
});
