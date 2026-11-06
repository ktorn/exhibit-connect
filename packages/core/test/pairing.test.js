import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  broadcastMode,
  defaultPersistedState,
  verifyPairingCode,
} from "../src/pairing.js";

describe("broadcastMode", () => {
  it("discovery when unpaired", () => {
    assert.equal(broadcastMode(defaultPersistedState(), null, 0), "discovery");
  });

  it("silent when paired tablet recently pinged", () => {
    const s = { pairedTabletId: "t1", pairedAt: "x", lastTabletPingMs: 1000 };
    assert.equal(broadcastMode(s, null, 30_000), "silent");
  });

  it("reconnect when paired but idle", () => {
    const s = { pairedTabletId: "t1", pairedAt: "x", lastTabletPingMs: 1000 };
    assert.equal(broadcastMode(s, null, 100_000), "reconnect");
  });
});

describe("verifyPairingCode", () => {
  it("accepts matching code", () => {
    const active = { tabletId: "t1", code: "123456", expiresAtMs: 9999 };
    assert.deepEqual(verifyPairingCode(active, "t1", "123456", 1000), { ok: true });
  });
});
