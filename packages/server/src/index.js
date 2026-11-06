import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createStateStore } from "./state-store.js";
import { createProjectionHub } from "./projection-hub.js";
import { createExhibitConnectHandlers } from "./http-handlers.js";
import { startBeaconLoop } from "./beacon-loop.js";
import { pickLanHost } from "./lan-host.js";

/**
 * @typedef {import('@exhibit-connect/core').ExhibitConfig & {
 *   lanHost?: string;
 *   stateDir?: string;
 *   adminToken?: string;
 *   beaconPort?: number;
 *   pairingPort?: number;
 * }} ExhibitConnectOptions
 */

/**
 * @param {ExhibitConnectOptions} options
 */
export function createExhibitConnectService(options) {
  const config = {
    exhibitId: options.exhibitId,
    displayName: options.displayName,
    student: options.student,
    httpPort: options.httpPort,
    controllerPath: options.controllerPath ?? "/controller.html",
  };

  const stateDir =
    options.stateDir ??
    path.join(
      process.env.PROGRAMDATA ?? path.join(os.homedir(), ".exhibit-connect"),
      "exhibit-connect",
    );
  const stateFile = path.join(stateDir, `${config.exhibitId}.json`);
  const stateStore = createStateStore(stateFile);
  const projectionHub = createProjectionHub();

  /** @type {import('@exhibit-connect/core').ActivePairing | null} */
  let activePairing = null;

  async function getLanHost() {
    return options.lanHost ?? pickLanHost();
  }

  const handle = createExhibitConnectHandlers({
    config,
    getLanHost,
    stateStore,
    getActivePairing: () => activePairing,
    setActivePairing: (p) => {
      activePairing = p;
    },
    projectionHub,
    adminToken: options.adminToken,
  });

  const pairingPort = options.pairingPort ?? options.httpPort;
  const beacon = startBeaconLoop({
    config,
    getLanHost,
    getPairingSnapshot: async () => ({
      persisted: await stateStore.get(),
      active: activePairing,
    }),
    port: options.beaconPort,
    getPairingBase:
      pairingPort !== options.httpPort
        ? async () => {
            const host = await getLanHost();
            return host ? `http://${host}:${pairingPort}` : undefined;
          }
        : undefined,
  });

  return {
    config,
    stateStore,
    projectionHub,
    handleRequest: handle,
    stop() {
      beacon.stop();
    },
  };
}

/**
 * Standalone HTTP server on `pairingPort` (default 41235) for sidecar use.
 * Exhibit HTTP server can instead call `handleRequest` on incoming requests.
 *
 * @param {ExhibitConnectOptions & { pairingPort?: number }} options
 */
export function startSidecarServer(options) {
  const service = createExhibitConnectService(options);
  const port = options.pairingPort ?? 41235;

  const server = http.createServer(async (req, res) => {
    const handled = await service.handleRequest(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `[exhibit-connect] sidecar listening on :${port} exhibit=${options.exhibitId}`,
    );
  });

  return { server, service };
}

export { pickLanHost } from "./lan-host.js";
export { createExhibitConnectHandlers, PREFIX } from "./http-handlers.js";
