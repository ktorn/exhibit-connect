/** @typedef {'discovery' | 'reconnect' | 'content'} BeaconMode */

/**
 * @typedef {Object} ExhibitConfig
 * @property {string} exhibitId
 * @property {string} displayName
 * @property {string} [student]
 * @property {number} httpPort
 * @property {string} [controllerPath]
 * @property {string} [role]
 * @property {string[]} [capabilities]
 */

/**
 * @typedef {Object} BeaconPayload
 * @property {1} v
 * @property {string} exhibitId
 * @property {string} displayName
 * @property {string} [student]
 * @property {number} httpPort
 * @property {string} [controllerPath]
 * @property {string} lanHost
 * @property {BeaconMode} mode
 * @property {string} httpBase
 * @property {string} [pairingBase]
 * @property {string} [role]
 * @property {string[]} [capabilities]
 */

export const BEACON_PROTOCOL_VERSION = 1;
export const DEFAULT_BEACON_PORT = 41234;

const MODES = new Set(["discovery", "reconnect", "content"]);

/**
 * @param {unknown} raw
 * @returns {BeaconPayload | null}
 */
export function decodeBeacon(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (obj);
  if (o.v !== BEACON_PROTOCOL_VERSION) return null;
  if (typeof o.exhibitId !== "string" || !o.exhibitId) return null;
  if (typeof o.displayName !== "string") return null;
  if (typeof o.httpPort !== "number" || o.httpPort <= 0) return null;
  if (typeof o.lanHost !== "string" || !o.lanHost) return null;
  if (typeof o.httpBase !== "string" || !o.httpBase) return null;
  if (typeof o.mode !== "string" || !MODES.has(o.mode)) return null;
  /** @type {BeaconPayload} */
  const out = {
    v: 1,
    exhibitId: o.exhibitId,
    displayName: o.displayName,
    student: typeof o.student === "string" ? o.student : undefined,
    httpPort: o.httpPort,
    lanHost: o.lanHost,
    mode: /** @type {BeaconMode} */ (o.mode),
    httpBase: o.httpBase.replace(/\/$/, ""),
  };
  if (o.mode === "content") {
    if (typeof o.controllerPath === "string" && o.controllerPath.startsWith("/")) {
      out.controllerPath = o.controllerPath;
    }
  } else {
    out.controllerPath =
      typeof o.controllerPath === "string" && o.controllerPath.startsWith("/")
        ? o.controllerPath
        : "/controller.html";
  }
  if (typeof o.pairingBase === "string" && o.pairingBase) {
    out.pairingBase = o.pairingBase.replace(/\/$/, "");
  }
  if (typeof o.role === "string" && o.role) {
    out.role = o.role;
  }
  if (Array.isArray(o.capabilities)) {
    out.capabilities = o.capabilities.filter((c) => typeof c === "string");
  }
  return out;
}

/**
 * @param {ExhibitConfig & { lanHost: string; mode: BeaconMode; pairingBase?: string }} input
 * @returns {BeaconPayload}
 */
export function encodeBeacon(input) {
  const httpBase = `http://${input.lanHost}:${input.httpPort}`;
  /** @type {BeaconPayload} */
  const payload = {
    v: BEACON_PROTOCOL_VERSION,
    exhibitId: input.exhibitId,
    displayName: input.displayName,
    student: input.student,
    httpPort: input.httpPort,
    lanHost: input.lanHost,
    mode: input.mode,
    httpBase,
  };
  if (input.mode !== "content") {
    payload.controllerPath = input.controllerPath ?? "/controller.html";
  }
  if (input.pairingBase) {
    payload.pairingBase = input.pairingBase.replace(/\/$/, "");
  }
  if (input.role) payload.role = input.role;
  if (input.capabilities?.length) payload.capabilities = input.capabilities;
  return payload;
}

/**
 * @param {BeaconPayload} payload
 * @returns {Buffer}
 */
export function beaconToBuffer(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

/** Pairing tablets should ignore these. */
export function isPairingBeacon(payload) {
  return payload.mode === "discovery" || payload.mode === "reconnect";
}

export function isContentBeacon(payload) {
  return (
    payload.mode === "content" ||
    (Array.isArray(payload.capabilities) && payload.capabilities.includes("content"))
  );
}
