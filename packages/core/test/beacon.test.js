import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeBeacon, encodeBeacon, beaconToBuffer } from "../src/beacon.js";

describe("beacon", () => {
  it("round-trips encode/decode", () => {
    const payload = encodeBeacon({
      exhibitId: "test-1",
      displayName: "Test",
      student: "Ada",
      httpPort: 8899,
      lanHost: "10.0.0.5",
      mode: "discovery",
    });
    const decoded = decodeBeacon(JSON.parse(beaconToBuffer(payload).toString("utf8")));
    assert.deepEqual(decoded, payload);
  });

  it("rejects wrong version", () => {
    assert.equal(decodeBeacon({ v: 2, exhibitId: "x", httpPort: 1, lanHost: "a", httpBase: "h", mode: "discovery" }), null);
  });

  it("round-trips content/signage beacons without a controller path", () => {
    const payload = encodeBeacon({
      exhibitId: "lobby",
      displayName: "Lobby map",
      httpPort: 41235,
      lanHost: "10.0.0.8",
      mode: "content",
      role: "display",
      capabilities: ["content"],
    });
    assert.equal(payload.controllerPath, undefined);
    const decoded = decodeBeacon(JSON.parse(beaconToBuffer(payload).toString("utf8")));
    assert.deepEqual(decoded, payload);
  });
});
