import { Type } from "../api.js";
import type { OpenClawPluginApi } from "../api.js";

type UiArtifactToolParams = {
  title?: unknown;
  summaryMarkdown?: unknown;
  html?: unknown;
  htmlPath?: unknown;
  canvasUrl?: unknown;
  preferredHeight?: unknown;
};

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeHeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1200, Math.max(220, Math.trunc(value)))
    : 560;
}

export function createUiArtifactTool(api: OpenClawPluginApi) {
  return {
    name: "ui_artifact",
    label: "UI Artifact",
    description:
      "Materialize model-generated HTML into a hosted UI companion artifact that can render beside the normal Markdown answer.",
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      summaryMarkdown: Type.String(),
      html: Type.Optional(Type.String()),
      htmlPath: Type.Optional(Type.String()),
      canvasUrl: Type.Optional(Type.String()),
      preferredHeight: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId: string, params: UiArtifactToolParams) {
      const title = normalizeString(params.title, "Generated Report");
      const summaryMarkdown = normalizeString(params.summaryMarkdown);
      const html = normalizeString(params.html);
      const htmlPath = normalizeString(params.htmlPath);
      const canvasUrl = normalizeString(params.canvasUrl);
      if (!summaryMarkdown) {
        throw new Error("summaryMarkdown is required");
      }
      const preferredHeight = normalizeHeight(params.preferredHeight);

      let artifactId = "";
      let artifactUrl = "";
      let artifactTitle = title;
      let artifactPreferredHeight = preferredHeight;

      if (canvasUrl) {
        artifactUrl = canvasUrl;
        artifactId = resolveCanvasArtifactId(canvasUrl);
      } else {
        if (!html) {
          throw new Error("html is required when canvasUrl is not provided");
        }
        const artifact = await api.runtime.richArtifacts.createCanvasArtifact({
          kind: "html_bundle",
          title,
          preferredHeight,
          html,
          surface: "assistant_message",
        });
        artifactId = artifact.manifest.id;
        artifactUrl = artifact.manifest.entryUrl;
        artifactTitle = artifact.manifest.title ?? title;
        artifactPreferredHeight = artifact.manifest.preferredHeight ?? preferredHeight;
      }

      if (!artifactUrl) {
        throw new Error("failed to resolve artifact URL");
      }

      const payload = {
        kind: "ui_artifact",
        summary_markdown: summaryMarkdown,
        artifact: {
          backend: "canvas",
          id: artifactId,
          url: artifactUrl,
          title: artifactTitle,
          preferred_height: artifactPreferredHeight,
          ...(htmlPath ? { html_path: htmlPath } : {}),
        },
        presentation: {
          target: "assistant_message",
          layout: "companion",
          placement: "after_markdown",
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  };
}

function resolveCanvasArtifactId(canvasUrl: string): string {
  const match = /\/__openclaw__\/canvas\/documents\/([^/]+)\//u.exec(canvasUrl);
  return match?.[1] ?? "";
}
