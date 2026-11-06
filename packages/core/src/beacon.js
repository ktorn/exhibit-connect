/** @typedef {'discovery' | 'reconnect'} BeaconMode */

/**
 * @typedef {Object} ExhibitConfig
 * @property {string} exhibitId
 * @property {string} displayName
 * @property {string} [student]
 * @property {number} httpPort
 * @property {string} [controllerPath]
 */

/**
 * @typedef {Object} BeaconPayload
 * @property {1} v
 * @property {string} exhibitId
 * @property {string} displayName
 * @property {string} [student]
 * @property {number} httpPort
 * @property {string} controllerPath
 * @property {string} lanHost
 * @property {BeaconMode} mode
 * @property {string} httpBase
 * @property {string} [pairingBase] HTTP API base if different from exhibit server
 */

export const BEACON_PROTOCOL_VERSION = 1;
export const DEFAULT_BEACON_PORT = 41234;

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
  if (o.mode !== "discovery" && o.mode !== "reconnect") return null;
  const controllerPath =
    typeof o.controllerPath === "string" && o.controllerPath.startsWith("/")
      ? o.controllerPath
      : "/controller.html";
  const out = {
    v: 1,
    exhibitId: o.exhibitId,
    displayName: o.displayName,
    student: typeof o.student === "string" ? o.student : undefined,
    httpPort: o.httpPort,
    controllerPath,
    lanHost: o.lanHost,
    mode: o.mode,
    httpBase: o.httpBase.replace(/\/$/, ""),
  };
  if (typeof o.pairingBase === "string" && o.pairingBase) {
    out.pairingBase = o.pairingBase.replace(/\/$/, "");
  }
  return out;
}

/**
 * @param {ExhibitConfig & { lanHost: string; mode: BeaconMode; pairingBase?: string }} input
 * @returns {BeaconPayload}
 */
export function encodeBeacon(input) {
  const controllerPath = input.controllerPath ?? "/controller.html";
  const httpBase = `http://${input.lanHost}:${input.httpPort}`;
  /** @type {BeaconPayload} */
  const payload = {
    v: BEACON_PROTOCOL_VERSION,
    exhibitId: input.exhibitId,
    displayName: input.displayName,
    student: input.student,
    httpPort: input.httpPort,
    controllerPath,
    lanHost: input.lanHost,
    mode: input.mode,
    httpBase,
  };
  if (input.pairingBase) {
    payload.pairingBase = input.pairingBase.replace(/\/$/, "");
  }
  return payload;
}

/**
 * @param {BeaconPayload} payload
 * @returns {Buffer}
 */
export function beaconToBuffer(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}
