/**
 * LAN signage console: UDP discovery + staff UI.
 * Run on a laptop on the gallery Wi‑Fi (not on the kiosk):
 *   npm run manager
 */
import dgram from "node:dgram";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBeacon, DEFAULT_BEACON_PORT, isContentBeacon } from "@exhibit-connect/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.EXHIBIT_CONNECT_MANAGER_PORT) || 4173;
const BEACON_PORT = Number(process.env.EXHIBIT_CONNECT_BEACON_PORT) || DEFAULT_BEACON_PORT;
const STALE_MS = 10_000;

/** @type {Map<string, { exhibitId: string, displayName: string, role: string, mode: string, httpBase: string, lanHost: string, lastSeen: number }>} */
const screens = new Map();

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
socket.on("message", (msg) => {
  const payload = decodeBeacon(msg.toString("utf8"));
  if (!payload || !isContentBeacon(payload)) return;
  screens.set(payload.exhibitId, {
    exhibitId: payload.exhibitId,
    displayName: payload.displayName,
    role: payload.role || (payload.mode === "content" ? "display" : "host"),
    mode: payload.mode,
    httpBase: payload.pairingBase || payload.httpBase,
    lanHost: payload.lanHost,
    lastSeen: Date.now(),
  });
});
socket.bind(BEACON_PORT, () => {
  try {
    socket.setBroadcast(true);
  } catch {
    /* ignore */
  }
  console.log(`[exhibit-connect] manager listening for beacons on UDP :${BEACON_PORT}`);
});

function liveScreens() {
  const now = Date.now();
  for (const [id, s] of screens) {
    if (now - s.lastSeen > STALE_MS) screens.delete(id);
  }
  return [...screens.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/screens") {
    const body = JSON.stringify({ v: 1, screens: liveScreens() });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(body);
    return;
  }
  let file = url.pathname === "/" || url.pathname === "/manager" || url.pathname === "/manager.html"
    ? "manager.html"
    : url.pathname === "/manager.js"
      ? "manager.js"
      : null;
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const fp = path.join(here, file);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[exhibit-connect] signage manager http://127.0.0.1:${PORT}/`);
  console.log("Paste Figma / exhibit URLs here. Do not type them on the kiosk.");
});
