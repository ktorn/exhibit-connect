import {
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  generatePairingCode,
  isTabletConnected,
  verifyPairingCode,
} from "@exhibit-connect/core";

const PREFIX = "/__exhibit-connect/v1";

/**
 * @param {import('node:http').IncomingMessage} req
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * @param {object} ctx
 */
export function createExhibitConnectHandlers(ctx) {
  const {
    config,
    getLanHost,
    stateStore,
    getActivePairing,
    setActivePairing,
    projectionHub,
    adminToken,
  } = ctx;

  async function statusPayload() {
    const persisted = await stateStore.get();
    const active = getActivePairing();
    const now = Date.now();
    const lanHost = await getLanHost();
    const httpBase = lanHost ? `http://${lanHost}:${config.httpPort}` : null;
    return {
      v: 1,
      exhibitId: config.exhibitId,
      displayName: config.displayName,
      paired: Boolean(persisted.pairedTabletId),
      pairedTabletId: persisted.pairedTabletId,
      discoveryEnabled: !persisted.pairedTabletId,
      tabletConnected: isTabletConnected(persisted, now),
      pairing: active && active.expiresAtMs > now
        ? { expiresAt: new Date(active.expiresAtMs).toISOString(), codeLength: PAIRING_CODE_LENGTH }
        : null,
      lanHost,
      httpBase,
      controllerPath: config.controllerPath ?? "/controller.html",
    };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {boolean} true if handled
   */
  return async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(PREFIX)) return false;

    const path = url.pathname.slice(PREFIX.length) || "/";

    try {
      if (req.method === "GET" && path === "/status") {
        json(res, 200, await statusPayload());
        return true;
      }

      if (req.method === "GET" && path === "/projection") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("\n");
        projectionHub.subscribe(res);
        return true;
      }

      const body = req.method === "POST" ? await readJsonBody(req) : {};

      if (req.method === "POST" && path === "/pair/start") {
        const persisted = await stateStore.get();
        if (persisted.pairedTabletId) {
          json(res, 409, { error: "already_paired", message: "Tablet already paired" });
          return true;
        }
        const tabletId = typeof body.tabletId === "string" ? body.tabletId : "";
        if (!tabletId) {
          json(res, 400, { error: "invalid_body", message: "tabletId required" });
          return true;
        }
        const code = generatePairingCode();
        const expiresAtMs = Date.now() + PAIRING_TTL_MS;
        setActivePairing({ tabletId, code, expiresAtMs });
        projectionHub.emit("pairing-code", {
          code,
          expiresAt: new Date(expiresAtMs).toISOString(),
        });
        json(res, 200, { ok: true, expiresInSec: Math.floor(PAIRING_TTL_MS / 1000) });
        return true;
      }

      if (req.method === "POST" && path === "/pair/confirm") {
        const tabletId = typeof body.tabletId === "string" ? body.tabletId : "";
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!tabletId || !code) {
          json(res, 400, { error: "invalid_body", message: "tabletId and code required" });
          return true;
        }
        const result = verifyPairingCode(getActivePairing(), tabletId, code);
        if (!result.ok) {
          json(res, 403, { error: result.reason, message: "Pairing failed" });
          return true;
        }
        setActivePairing(null);
        projectionHub.emit("pairing-cleared", {});
        await stateStore.update((s) => ({
          ...s,
          pairedTabletId: tabletId,
          pairedAt: new Date().toISOString(),
          lastTabletPingMs: Date.now(),
        }));
        projectionHub.emit("tablet-connected", { tabletId });
        const lanHost = await getLanHost();
        const httpBase = lanHost ? `http://${lanHost}:${config.httpPort}` : "";
        const controllerPath = config.controllerPath ?? "/controller.html";
        json(res, 200, {
          ok: true,
          httpBase,
          controllerPath,
          controllerUrl: `${httpBase}${controllerPath}`,
        });
        return true;
      }

      if (req.method === "POST" && path === "/tablet/ping") {
        const tabletId = typeof body.tabletId === "string" ? body.tabletId : "";
        const persisted = await stateStore.get();
        if (!persisted.pairedTabletId || persisted.pairedTabletId !== tabletId) {
          json(res, 403, { error: "not_paired", message: "Tablet not paired" });
          return true;
        }
        await stateStore.update((s) => ({
          ...s,
          lastTabletPingMs: Date.now(),
        }));
        json(res, 200, { ok: true });
        return true;
      }

      if (req.method === "POST" && path === "/pair/reset") {
        if (adminToken) {
          const token = typeof body.adminToken === "string" ? body.adminToken : "";
          if (token !== adminToken) {
            json(res, 403, { error: "forbidden", message: "Invalid admin token" });
            return true;
          }
        }
        setActivePairing(null);
        projectionHub.emit("pairing-cleared", {});
        await stateStore.update(() => ({
          pairedTabletId: null,
          pairedAt: null,
          lastTabletPingMs: null,
        }));
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 404, { error: "not_found", message: "Unknown route" });
      return true;
    } catch (err) {
      json(res, 500, {
        error: "internal_error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
      return true;
    }
  };
}

export { PREFIX };
