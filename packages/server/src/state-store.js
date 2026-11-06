import fs from "node:fs/promises";
import path from "node:path";
import { defaultPersistedState } from "@exhibit-connect/core";

/**
 * @param {string} filePath
 */
export function createStateStore(filePath) {
  /** @type {import('@exhibit-connect/core').PersistedState} */
  let state = defaultPersistedState();
  let loaded = false;

  async function load() {
    if (loaded) return state;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      state = {
        pairedTabletId: parsed.pairedTabletId ?? null,
        pairedAt: parsed.pairedAt ?? null,
        lastTabletPingMs: parsed.lastTabletPingMs ?? null,
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
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  return {
    async get() {
      await load();
      return state;
    },
    async update(fn) {
      await load();
      state = fn(state);
      await save();
      return state;
    },
  };
}
