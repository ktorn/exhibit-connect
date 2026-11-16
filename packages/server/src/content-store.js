import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultContentState,
  isAllowedContentUrl,
  isContentId,
  MAX_UPLOAD_BYTES,
  resolveUploadMime,
  sanitizeFilename,
} from "@exhibit-connect/core";

/**
 * @param {{ dir: string, maxUploadBytes?: number }} opts
 */
export function createContentStore(opts) {
  const dir = opts.dir;
  const filesDir = path.join(dir, "files");
  const metaFile = path.join(dir, "meta.json");
  const maxUploadBytes = opts.maxUploadBytes ?? MAX_UPLOAD_BYTES;

  /** @type {ReturnType<typeof defaultContentState>} */
  let state = defaultContentState();
  let loaded = false;
  let chain = Promise.resolve();

  function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function load() {
    if (loaded) return state;
    try {
      const raw = await fs.readFile(metaFile, "utf8");
      const parsed = JSON.parse(raw);
      state = {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        current: parsed.current ?? null,
      };
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") {
        throw err;
      }
    }
    loaded = true;
    return state;
  }

  async function save() {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${metaFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, metaFile);
  }

  function itemById(id) {
    return state.items.find((it) => it.id === id) ?? null;
  }

  return {
    maxUploadBytes,
    filesDir,
    filePath(id) {
      return path.join(filesDir, id);
    },
    async get() {
      return withLock(async () => {
        await load();
        return state;
      });
    },
    async addFile({ name, mime, destName }) {
      return withLock(async () => {
        await load();
        const filename = sanitizeFilename(name);
        const resolved = resolveUploadMime(filename, mime);
        if (!resolved) {
          const err = new Error("unsupported_type");
          err.code = "unsupported_type";
          throw err;
        }
        const id = destName && isContentId(destName) ? destName : randomUUID();
        const st = await fs.stat(path.join(filesDir, id));
        const item = {
          id,
          type: "file",
          name: filename,
          mime: resolved,
          size: st.size,
          createdAt: new Date().toISOString(),
        };
        state = { ...state, items: [...state.items, item] };
        await save();
        return item;
      });
    },
    async addUrl({ url, name }) {
      return withLock(async () => {
        await load();
        if (!isAllowedContentUrl(url)) {
          const err = new Error("invalid_url");
          err.code = "invalid_url";
          throw err;
        }
        const existing = state.items.find((it) => it.type === "url" && it.url === url);
        if (existing) return existing;
        const item = {
          id: randomUUID(),
          type: "url",
          name: name?.trim() || url,
          url,
          createdAt: new Date().toISOString(),
        };
        state = { ...state, items: [...state.items, item] };
        await save();
        return item;
      });
    },
    async setCurrent(spec) {
      return withLock(async () => {
        await load();
        if (!spec || spec.type === "none" || spec.type === null) {
          state = { ...state, current: null };
          await save();
          return state;
        }
        if (spec.type === "url") {
          if (!isAllowedContentUrl(spec.url)) {
            const err = new Error("invalid_url");
            err.code = "invalid_url";
            throw err;
          }
          let item = state.items.find((it) => it.type === "url" && it.url === spec.url);
          if (!item) {
            item = {
              id: randomUUID(),
              type: "url",
              name: spec.name?.trim() || spec.url,
              url: spec.url,
              createdAt: new Date().toISOString(),
            };
            state = { ...state, items: [...state.items, item] };
          }
          state = { ...state, current: { type: "url", id: item.id, url: spec.url } };
          await save();
          return state;
        }
        if (spec.type === "file") {
          const item = itemById(spec.id);
          if (!item || item.type !== "file") {
            const err = new Error("not_found");
            err.code = "not_found";
            throw err;
          }
          state = { ...state, current: { type: "file", id: item.id } };
          await save();
          return state;
        }
        const err = new Error("invalid_body");
        err.code = "invalid_body";
        throw err;
      });
    },
    async remove(id) {
      return withLock(async () => {
        await load();
        const item = itemById(id);
        if (!item) {
          const err = new Error("not_found");
          err.code = "not_found";
          throw err;
        }
        state = {
          items: state.items.filter((it) => it.id !== id),
          current:
            state.current &&
            (state.current.id === id ||
              (item.type === "url" && state.current.url === item.url))
              ? null
              : state.current,
        };
        await save();
        if (item.type === "file") {
          await fs.unlink(path.join(filesDir, id)).catch(() => {});
        }
        return state;
      });
    },
    async clear() {
      return withLock(async () => {
        await load();
        await fs.rm(filesDir, { recursive: true, force: true });
        await fs.mkdir(filesDir, { recursive: true });
        state = defaultContentState();
        await save();
        return state;
      });
    },
  };
}
