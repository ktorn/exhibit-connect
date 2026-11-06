import { randomInt } from "node:crypto";

export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const TABLET_IDLE_MS = 45 * 1000;

/**
 * @typedef {Object} PersistedState
 * @property {string | null} pairedTabletId
 * @property {string | null} pairedAt
 * @property {number | null} lastTabletPingMs
 */

/**
 * @typedef {Object} ActivePairing
 * @property {string} tabletId
 * @property {string} code
 * @property {number} expiresAtMs
 */

export function generatePairingCode(length = PAIRING_CODE_LENGTH) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/**
 * @param {PersistedState} persisted
 * @param {number} nowMs
 */
export function isTabletConnected(persisted, nowMs = Date.now()) {
  if (!persisted.pairedTabletId || persisted.lastTabletPingMs == null) {
    return false;
  }
  return nowMs - persisted.lastTabletPingMs < TABLET_IDLE_MS;
}

/**
 * @param {PersistedState} persisted
 * @param {ActivePairing | null} active
 * @param {number} nowMs
 * @returns {'discovery' | 'reconnect' | 'silent'}
 */
export function broadcastMode(persisted, active, nowMs = Date.now()) {
  if (active && active.expiresAtMs > nowMs) {
    return "discovery";
  }
  if (!persisted.pairedTabletId) {
    return "discovery";
  }
  if (isTabletConnected(persisted, nowMs)) {
    return "silent";
  }
  return "reconnect";
}

/**
 * @param {ActivePairing | null} active
 * @param {string} tabletId
 * @param {string} code
 * @param {number} nowMs
 */
export function verifyPairingCode(active, tabletId, code, nowMs = Date.now()) {
  if (!active) return { ok: false, reason: "no_active_pairing" };
  if (active.expiresAtMs <= nowMs) return { ok: false, reason: "expired" };
  if (active.tabletId !== tabletId) return { ok: false, reason: "tablet_mismatch" };
  if (active.code !== code) return { ok: false, reason: "invalid_code" };
  return { ok: true };
}

export function defaultPersistedState() {
  return /** @type {PersistedState} */ ({
    pairedTabletId: null,
    pairedAt: null,
    lastTabletPingMs: null,
  });
}
