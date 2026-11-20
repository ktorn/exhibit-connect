/** 6 GiB — exhibition loops; still bounded for kiosk storage. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024 * 1024;
export const API_PREFIX = "/__exhibit-connect/v1";

const MIME_BY_EXT = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  ogg: "video/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  txt: "text/plain",
  json: "application/json",
};

const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "text/plain",
  "application/json",
]);

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isContentId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

export function guessMime(filename) {
  const ext = String(filename || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  return MIME_BY_EXT[ext ?? ""] ?? "application/octet-stream";
}

export function sanitizeFilename(name) {
  const base = String(name || "file").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return cleaned || "file";
}

/**
 * @param {string} filename
 * @param {string} [mime]
 * @returns {string | null}
 */
export function resolveUploadMime(filename, mime) {
  const clean = String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const guessed = guessMime(filename);
  if (ALLOWED_MIME.has(clean)) {
    return clean === "application/javascript" ? "text/javascript" : clean;
  }
  if (ALLOWED_MIME.has(guessed)) return guessed;
  return null;
}

export function isPlayableVideo(mime) {
  return typeof mime === "string" && mime.startsWith("video/");
}

export function filePublicPath(id) {
  return `${API_PREFIX}/content/files/${id}`;
}

export function defaultContentState() {
  return { items: [], current: null };
}

/**
 * @param {string} url
 */
export function isAllowedContentUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {{ type?: string, id?: string, url?: string } | null} current
 * @param {string} httpBase
 */
export function resolveCurrentUrl(current, httpBase) {
  if (!current) return null;
  if (current.type === "url" && typeof current.url === "string") {
    return current.url;
  }
  if (current.type === "file" && current.id) {
    return `${String(httpBase || "").replace(/\/$/, "")}${filePublicPath(current.id)}`;
  }
  return null;
}

/**
 * @param {object} state
 * @param {string} httpBase
 * @param {number} [maxUploadBytes]
 */
export function decorateContentState(state, httpBase, maxUploadBytes = MAX_UPLOAD_BYTES) {
  const base = String(httpBase || "").replace(/\/$/, "");
  const items = Array.isArray(state?.items) ? state.items : [];
  return {
    v: 1,
    items: items.map((item) => ({
      ...item,
      url:
        item.type === "file"
          ? `${base}${filePublicPath(item.id)}`
          : item.url,
    })),
    current: state?.current
      ? {
          ...state.current,
          url: resolveCurrentUrl(state.current, base),
        }
      : null,
    maxUploadBytes,
  };
}
