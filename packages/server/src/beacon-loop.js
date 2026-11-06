import dgram from "node:dgram";
import {
  DEFAULT_BEACON_PORT,
  encodeBeacon,
  beaconToBuffer,
  broadcastMode,
} from "@exhibit-connect/core";

/**
 * @param {object} opts
 * @param {import('@exhibit-connect/core').ExhibitConfig} opts.config
 * @param {() => Promise<string | null>} opts.getLanHost
 * @param {() => Promise<{ persisted: import('@exhibit-connect/core').PersistedState, active: import('@exhibit-connect/core').ActivePairing | null }>} opts.getPairingSnapshot
 * @param {number} [opts.port]
 * @param {number} [opts.intervalMs]
 * @param {() => Promise<string | undefined>} [opts.getPairingBase]
 */
export function startBeaconLoop(opts) {
  const port = opts.port ?? DEFAULT_BEACON_PORT;
  const intervalMs = opts.intervalMs ?? 2000;
  const socket = dgram.createSocket("udp4");

  async function tick() {
    const lanHost = await opts.getLanHost();
    if (!lanHost) return;
    const { persisted, active } = await opts.getPairingSnapshot();
    const mode = broadcastMode(persisted, active);
    if (mode === "silent") return;

    const pairingBase = opts.getPairingBase ? await opts.getPairingBase() : undefined;
    const payload = encodeBeacon({
      ...opts.config,
      lanHost,
      mode,
      pairingBase,
    });
    const buf = beaconToBuffer(payload);
    socket.send(buf, port, "255.255.255.255", () => {});
    socket.send(buf, port, "127.0.0.1", () => {});
  }

  socket.bind(() => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* ignore */
    }
    tick();
  });

  const timer = setInterval(tick, intervalMs);

  return {
    stop() {
      clearInterval(timer);
      socket.close();
    },
  };
}
