import { describe, expect, it } from "vitest";
import { resolveCanvasIframeUrl } from "./canvas-url.ts";

describe("resolveCanvasIframeUrl", () => {
  it("defers same-origin hosted canvas document paths until a scoped canvas host is available", () => {
    expect(
      resolveCanvasIframeUrl("/__openclaw__/canvas/documents/cv_demo/index.html"),
    ).toBeUndefined();
    expect(
      resolveCanvasIframeUrl("/__openclaw__/canvas/documents/cv_demo/index.html", null),
    ).toBeUndefined();
  });

  it("rewrites safe canvas paths through the scoped canvas host", () => {
    expect(
      resolveCanvasIframeUrl(
        "/__openclaw__/canvas/documents/cv_demo/index.html",
        "http://127.0.0.1:19003/__openclaw__/cap/cap_123",
      ),
    ).toBe(
      "http://127.0.0.1:19003/__openclaw__/cap/cap_123/__openclaw__/canvas/documents/cv_demo/index.html",
    );
  });

  it("rewrites local absolute canvas URLs through the scoped canvas host", () => {
    expect(
      resolveCanvasIframeUrl(
        "http://127.0.0.1:19289/__openclaw__/canvas/documents/cv_demo/index.html",
        "http://127.0.0.1:19003/__openclaw__/cap/cap_123",
      ),
    ).toBe(
      "http://127.0.0.1:19003/__openclaw__/cap/cap_123/__openclaw__/canvas/documents/cv_demo/index.html",
    );
  });

  it("rewrites remote absolute canvas URLs through the scoped canvas host", () => {
    expect(
      resolveCanvasIframeUrl(
        "http://10.120.212.87/__openclaw__/canvas/documents/cv_demo/index.html",
        "http://127.0.0.1:19003/__openclaw__/cap/cap_123",
      ),
    ).toBe(
      "http://127.0.0.1:19003/__openclaw__/cap/cap_123/__openclaw__/canvas/documents/cv_demo/index.html",
    );
  });

  it("rejects internal canvas paths when the host is not capability scoped", () => {
    expect(
      resolveCanvasIframeUrl(
        "/__openclaw__/canvas/documents/cv_demo/index.html",
        "http://127.0.0.1:19003",
      ),
    ).toBeUndefined();
  });

  it("rejects non-canvas same-origin paths", () => {
    expect(resolveCanvasIframeUrl("/not-canvas/snake.html")).toBeUndefined();
  });

  it("rejects absolute external URLs", () => {
    expect(resolveCanvasIframeUrl("https://example.com/evil.html")).toBeUndefined();
  });

  it("keeps explicitly allowed external embed URLs without a scoped canvas host", () => {
    expect(resolveCanvasIframeUrl("https://example.com/embed.html?x=1#y", undefined, true)).toBe(
      "https://example.com/embed.html?x=1#y",
    );
  });

  it("allows absolute external URLs only when explicitly enabled", () => {
    expect(resolveCanvasIframeUrl("https://example.com/embed.html?x=1#y", undefined, true)).toBe(
      "https://example.com/embed.html?x=1#y",
    );
  });

  it("rejects file URLs", () => {
    expect(resolveCanvasIframeUrl("file:///tmp/snake.html")).toBeUndefined();
  });
});
