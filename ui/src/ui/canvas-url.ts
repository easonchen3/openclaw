const A2UI_PATH = "/__openclaw__/a2ui";
const CANVAS_HOST_PATH = "/__openclaw__/canvas";
const CANVAS_CAPABILITY_PATH_PREFIX = "/__openclaw__/cap";
const LOCAL_CANVAS_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isCanvasHttpPath(pathname: string): boolean {
  return (
    pathname === CANVAS_HOST_PATH ||
    pathname.startsWith(`${CANVAS_HOST_PATH}/`) ||
    pathname === A2UI_PATH ||
    pathname.startsWith(`${A2UI_PATH}/`)
  );
}

function isExternalHttpUrl(entry: URL): boolean {
  return entry.protocol === "http:" || entry.protocol === "https:";
}

function isLocalCanvasHttpUrl(entry: URL): boolean {
  return (
    isExternalHttpUrl(entry) &&
    LOCAL_CANVAS_HOSTS.has(entry.hostname) &&
    isCanvasHttpPath(entry.pathname)
  );
}

function sanitizeCanvasEntryUrl(
  rawEntryUrl: string,
  allowExternalEmbedUrls = false,
): string | undefined {
  try {
    const entry = new URL(rawEntryUrl, "http://localhost");
    if (entry.origin !== "http://localhost") {
      if (isLocalCanvasHttpUrl(entry)) {
        return `${entry.pathname}${entry.search}${entry.hash}`;
      }
      if (!allowExternalEmbedUrls || !isExternalHttpUrl(entry)) {
        return undefined;
      }
      return entry.toString();
    }
    if (!isCanvasHttpPath(entry.pathname)) {
      return undefined;
    }
    return `${entry.pathname}${entry.search}${entry.hash}`;
  } catch {
    return undefined;
  }
}

export function resolveCanvasIframeUrl(
  entryUrl: string | undefined,
  canvasHostUrl?: string | null,
  allowExternalEmbedUrls = false,
): string | undefined {
  const rawEntryUrl = entryUrl?.trim();
  if (!rawEntryUrl) {
    return undefined;
  }
  const safeEntryUrl = sanitizeCanvasEntryUrl(rawEntryUrl, allowExternalEmbedUrls);
  if (!safeEntryUrl) {
    return undefined;
  }
  let isInternalCanvasUrl = false;
  try {
    const entry = new URL(safeEntryUrl, "http://localhost");
    isInternalCanvasUrl = entry.origin === "http://localhost" && isCanvasHttpPath(entry.pathname);
  } catch {
    return undefined;
  }
  if (!isInternalCanvasUrl) {
    return safeEntryUrl;
  }
  const scopedCanvasHostUrl = canvasHostUrl?.trim();
  if (!scopedCanvasHostUrl) {
    return undefined;
  }
  try {
    const scopedHostUrl = new URL(scopedCanvasHostUrl);
    const scopedPrefix = scopedHostUrl.pathname.replace(/\/+$/, "");
    if (!scopedPrefix.startsWith(CANVAS_CAPABILITY_PATH_PREFIX)) {
      return undefined;
    }
    const entry = new URL(safeEntryUrl, scopedHostUrl.origin);
    if (!isCanvasHttpPath(entry.pathname)) {
      return undefined;
    }
    entry.protocol = scopedHostUrl.protocol;
    entry.username = scopedHostUrl.username;
    entry.password = scopedHostUrl.password;
    entry.host = scopedHostUrl.host;
    entry.pathname = `${scopedPrefix}${entry.pathname}`;
    return entry.toString();
  } catch {
    return undefined;
  }
}
