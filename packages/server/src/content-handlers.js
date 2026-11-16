import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  decorateContentState,
  isContentId,
} from "@exhibit-connect/core";
import { corsHeaders, json, mutateAuthorized, readJsonBody } from "./http-util.js";
import { bufferRequestToTemp, extractMultipartFile } from "./multipart.js";
import { managerAssetKind, sendManagerAsset } from "./manager-files.js";

/**
 * @param {object} ctx
 */
export function createContentHandlers(ctx) {
  const { config, getLanHost, contentStore, adminToken } = ctx;

  async function httpBase() {
    const lanHost = await getLanHost();
    const port = config.apiPort ?? config.httpPort;
    return lanHost ? `http://${lanHost}:${port}` : "";
  }

  async function payload() {
    const state = await contentStore.get();
    return decorateContentState(state, await httpBase(), contentStore.maxUploadBytes);
  }

  function requireAuth(req, res) {
    if (mutateAuthorized(req, adminToken)) return true;
    json(res, 401, { error: "unauthorized", message: "Admin token required" });
    return false;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} path path after API prefix
   */
  return async function handleContent(req, res, path) {
    const managerKind = managerAssetKind(path);
    if (req.method === "GET" && managerKind) {
      sendManagerAsset(res, managerKind);
      return true;
    }

    if (req.method === "GET" && path === "/content") {
      json(res, 200, await payload());
      return true;
    }

    if (req.method === "GET" && path.startsWith("/content/files/")) {
      const id = path.slice("/content/files/".length).split("/")[0];
      if (!isContentId(id)) {
        json(res, 400, { error: "invalid_id", message: "Bad content id" });
        return true;
      }
      const state = await contentStore.get();
      const item = state.items.find((it) => it.id === id && it.type === "file");
      if (!item) {
        json(res, 404, { error: "not_found", message: "File not found" });
        return true;
      }
      sendStoredFile(req, res, contentStore.filePath(id), item.mime || "application/octet-stream");
      return true;
    }

    if (req.method === "POST" && path === "/content/files") {
      if (!requireAuth(req, res)) return true;
      const ct = String(req.headers["content-type"] || "");
      if (!ct.toLowerCase().includes("multipart/form-data")) {
        json(res, 415, { error: "unsupported_media", message: "multipart/form-data required" });
        return true;
      }
      const id = randomUUID();
      const dest = contentStore.filePath(id);
      let tmp;
      try {
        await fsp.mkdir(contentStore.filesDir, { recursive: true });
        const buffered = await bufferRequestToTemp(req, contentStore.maxUploadBytes);
        tmp = buffered.tmp;
        const part = await extractMultipartFile(tmp, ct, dest);
        const item = await contentStore.addFile({
          name: part.filename,
          mime: part.mime,
          destName: id,
        });
        json(res, 201, { ok: true, item });
      } catch (err) {
        await fsp.unlink(dest).catch(() => {});
        const code = /** @type {{ code?: string }} */ (err).code;
        if (code === "too_large") {
          json(res, 413, { error: "too_large", message: "File exceeds upload limit" });
          return true;
        }
        if (code === "unsupported_type") {
          json(res, 415, { error: "unsupported_type", message: "File type not allowed" });
          return true;
        }
        if (code === "not_multipart") {
          json(res, 400, { error: "not_multipart", message: err instanceof Error ? err.message : "Bad multipart" });
          return true;
        }
        throw err;
      } finally {
        if (tmp) await fsp.unlink(tmp).catch(() => {});
      }
      return true;
    }

    if (req.method === "POST" && path === "/content/urls") {
      if (!requireAuth(req, res)) return true;
      const body = await readJsonBody(req);
      try {
        const item = await contentStore.addUrl({
          url: typeof body.url === "string" ? body.url.trim() : "",
          name: typeof body.name === "string" ? body.name : undefined,
        });
        if (body.current !== false) {
          await contentStore.setCurrent({ type: "url", url: item.url });
        }
        json(res, 201, { ok: true, item, content: await payload() });
      } catch (err) {
        const code = /** @type {{ code?: string }} */ (err).code;
        if (code === "invalid_url") {
          json(res, 400, { error: "invalid_url", message: "http(s) URL required" });
          return true;
        }
        throw err;
      }
      return true;
    }

    if (req.method === "PUT" && path === "/content/current") {
      if (!requireAuth(req, res)) return true;
      const body = await readJsonBody(req);
      try {
        await contentStore.setCurrent(body);
        json(res, 200, { ok: true, content: await payload() });
      } catch (err) {
        const code = /** @type {{ code?: string }} */ (err).code;
        if (code === "invalid_url") {
          json(res, 400, { error: "invalid_url", message: "http(s) URL required" });
          return true;
        }
        if (code === "not_found") {
          json(res, 404, { error: "not_found", message: "File not found" });
          return true;
        }
        if (code === "invalid_body") {
          json(res, 400, { error: "invalid_body", message: "type url|file|none required" });
          return true;
        }
        throw err;
      }
      return true;
    }

    if (req.method === "DELETE" && path.startsWith("/content/")) {
      if (!requireAuth(req, res)) return true;
      const rest = path.slice("/content/".length);
      if (rest === "files" || rest.startsWith("files/") || rest === "current" || rest === "urls") {
        return false;
      }
      const id = rest.split("/")[0];
      if (!isContentId(id)) {
        json(res, 400, { error: "invalid_id", message: "Bad content id" });
        return true;
      }
      try {
        await contentStore.remove(id);
        json(res, 200, { ok: true, content: await payload() });
      } catch (err) {
        const code = /** @type {{ code?: string }} */ (err).code;
        if (code === "not_found") {
          json(res, 404, { error: "not_found", message: "Not found" });
          return true;
        }
        throw err;
      }
      return true;
    }

    return false;
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @param {string} mime
 */
function sendStoredFile(req, res, filePath, mime) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      json(res, 404, { error: "not_found", message: "File missing on disk" });
      return;
    }
    const headers = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    };
    const range = parseRange(req.headers.range, st.size);
    if (req.headers.range && !range) {
      res.writeHead(416, {
        ...headers,
        "Content-Range": `bytes */${st.size}`,
      });
      res.end();
      return;
    }
    if (range) {
      const { start, end } = range;
      res.writeHead(206, {
        ...headers,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${st.size}`,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...headers, "Content-Length": st.size });
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

function parseRange(header, size) {
  if (!header || typeof header !== "string" || !header.startsWith("bytes=")) {
    return null;
  }
  const part = header.slice(6).split(",")[0].trim();
  const dash = part.indexOf("-");
  if (dash < 0) return null;
  const startStr = part.slice(0, dash);
  const endStr = part.slice(dash + 1);
  let start;
  let end;
  if (startStr === "") {
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? size - 1 : parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  }
  if (start >= size || start > end) return null;
  return { start: Math.max(0, start), end: Math.min(end, size - 1) };
}
