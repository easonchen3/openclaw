import fs from "node:fs/promises";
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
      const summaryMarkdownTemplate = normalizeString(params.summaryMarkdown);
      const html = normalizeString(params.html);
      const htmlPath = normalizeString(params.htmlPath);
      const canvasUrl = normalizeCanvasUrl(normalizeString(params.canvasUrl));
      if (!summaryMarkdownTemplate) {
        throw new Error("summaryMarkdown is required");
      }
      const preferredHeight = normalizeHeight(params.preferredHeight);

      let artifactId = "";
      let artifactUrl = "";
      let artifactTitle = title;
      let artifactPreferredHeight = preferredHeight;

      const materializedHtml = html || (htmlPath ? await readHtmlPath(htmlPath) : "");
      if (materializedHtml) {
        const artifact = await api.runtime.richArtifacts.createCanvasArtifact({
          kind: "html_bundle",
          title,
          preferredHeight,
          html: materializedHtml,
          surface: "assistant_message",
        });
        artifactId = artifact.manifest.id;
        artifactUrl = artifact.manifest.entryUrl;
        artifactTitle = artifact.manifest.title ?? title;
        artifactPreferredHeight = artifact.manifest.preferredHeight ?? preferredHeight;
      }

      if (!artifactUrl && canvasUrl) {
        artifactUrl = canvasUrl;
        artifactId = resolveCanvasArtifactId(canvasUrl);
      }

      if (!artifactUrl) {
        throw new Error("html or canvasUrl is required");
      }
      const summaryMarkdown = materializeSummaryMarkdown(
        summaryMarkdownTemplate,
        artifactUrl,
        canvasUrl,
      );

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

async function readHtmlPath(htmlPath: string): Promise<string> {
  try {
    return await fs.readFile(htmlPath, "utf8");
  } catch {
    return "";
  }
}

function resolveCanvasArtifactId(canvasUrl: string): string {
  const match = /\/__openclaw__\/canvas\/documents\/([^/]+)\//u.exec(canvasUrl);
  return match?.[1] ?? "";
}

function materializeSummaryMarkdown(
  summaryMarkdown: string,
  canvasUrl: string,
  sourceCanvasUrl = "",
): string {
  const bareDocumentPath = canvasUrl.match(/\/__openclaw__\/canvas\/documents\/([^?#]+)$/u)?.[1];
  const sourceBareDocumentPath =
    sourceCanvasUrl.match(/\/__openclaw__\/canvas\/documents\/([^?#]+)$/u)?.[1] ??
    sourceCanvasUrl.match(/^\/?([^/?#]+\/index\.html)(?:[?#].*)?$/u)?.[1];
  let materialized = summaryMarkdown.replaceAll("${CANVAS_URL}", canvasUrl);
  const paths = [
    ...new Set(
      [bareDocumentPath, sourceBareDocumentPath].filter((value): value is string => Boolean(value)),
    ),
  ];
  if (paths.length === 0) {
    return materialized;
  }
  for (const path of paths) {
    const escapedPath = escapeRegExp(path);
    materialized = materialized.replace(
      new RegExp(
        String.raw`(\]\()(?:https?:\/\/[^/\s)]+)?\/?(?:__openclaw__\/canvas\/documents\/)?${escapedPath}([?#][^)]*)?(\))`,
        "giu",
      ),
      (_match, open: string, _suffix: string | undefined, close: string) =>
        `${open}${canvasUrl}${close}`,
    );
  }
  return materialized;
}

function normalizeCanvasUrl(canvasUrl: string): string {
  if (!canvasUrl) {
    return "";
  }
  try {
    const parsed = new URL(canvasUrl, "http://localhost");
    if (parsed.pathname.startsWith("/__openclaw__/canvas/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const bareDocumentPath = normalizeBareDocumentPath(parsed.pathname, parsed.search, parsed.hash);
    if (bareDocumentPath) {
      return `/__openclaw__/canvas/documents/${bareDocumentPath}`;
    }
  } catch {
    // Fall through to the string-based path check below.
  }
  const bareDocumentPath = normalizeBareDocumentPath(canvasUrl);
  return bareDocumentPath ? `/__openclaw__/canvas/documents/${bareDocumentPath}` : canvasUrl;
}

function normalizeBareDocumentPath(pathname: string, search = "", hash = ""): string {
  const trimmed = pathname.trim().replace(/^\/+/u, "");
  if (!trimmed || trimmed.startsWith("__openclaw__/")) {
    return "";
  }
  if (!/^[^/?#]+\/index\.html$/u.test(trimmed)) {
    return "";
  }
  return `${trimmed}${search}${hash}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
