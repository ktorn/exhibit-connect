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
});
