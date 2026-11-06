/**
 * HTTP static server + WebSocket relay for phone/iPad controller → main display.
 *
 * Run: npm install && npm start   (PORT defaults to 8899; override with PORT=9000 npm start)
 *
 * - GET static files with Accept-Ranges / HTTP Range (206) — required for iPad/WebKit MP4
 * - GET /api/mapping → mapping-export.json if present (404 otherwise)
 * - GET /__relay_ok → plain text so controller.html can verify this relay (not python -m http.server)
 * - POST /api/command → optional HTTP mirror of lang_step (broadcasts over WebSocket to all clients)
 * - WebSocket /ws → JSON { type: "lang_step", step: ±1 } broadcast to every connected client
 */
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createExhibitConnectService } from "@exhibit-connect/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8899;
const PACKAGES = path.resolve(__dirname, "../../packages");
const VENDOR = {
  "/vendor/exhibit-connect-projection.js": path.join(
    PACKAGES,
    "projection/exhibit-connect-projection.js",
  ),
  "/tablet-pair.html": path.join(PACKAGES, "tablet-web/tablet-pair.html"),
  "/tablet-pair.js": path.join(PACKAGES, "tablet-web/tablet-pair.js"),
};

const exhibitConnect = createExhibitConnectService({
  exhibitId: "invisible-violence-2026",
  displayName: "Invisible Violence",
  student: "Mary",
  httpPort: PORT,
  controllerPath: "/controller.html",
  lanHost: process.env.EXHIBIT_CONNECT_LAN_HOST || undefined,
  stateDir: process.env.EXHIBIT_CONNECT_STATE_DIR || path.join(ROOT, ".state"),
  beaconPort: process.env.EXHIBIT_CONNECT_BEACON_PORT
    ? Number(process.env.EXHIBIT_CONNECT_BEACON_PORT)
    : undefined,
  adminToken: process.env.EXHIBIT_CONNECT_ADMIN_TOKEN || undefined,
});
const MAPPING_FILENAME = "mapping-export.json";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function mappingPath() {
  return path.join(ROOT, MAPPING_FILENAME);
}

function applyNoStore(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".webmanifest")
  );
}

function parseFirstByteRange(rangeHeader, fileSize) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }
  const part = rangeHeader.slice(6).split(",")[0].trim();
  const dash = part.indexOf("-");
  if (dash < 0) {
    return null;
  }
  const startStr = part.slice(0, dash);
  const endStr = part.slice(dash + 1);
  let start;
  let end;
  if (startStr === "") {
    const suffixLen = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      return null;
    }
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? fileSize - 1 : parseInt(endStr, 10);
    if (!Number.isFinite(start)) {
      return null;
    }
    if (!Number.isFinite(end)) {
      end = fileSize - 1;
    }
  }
  if (start >= fileSize || start > end) {
    return null;
  }
  end = Math.min(end, fileSize - 1);
  start = Math.max(0, start);
  if (start > end) {
    return null;
  }
  return { start, end };
}

/** Static files; MP4/Safari need Accept-Ranges + 206 partial responses. */
function sendStaticFile(req, res, filePath, pathname) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(err?.code === "ENOENT" ? 404 : 500);
      res.end(err?.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const size = st.size;
    const cacheHeaders = {};
    if (applyNoStore(pathname)) {
      cacheHeaders["Cache-Control"] = "no-store, max-age=0, must-revalidate";
      cacheHeaders.Pragma = "no-cache";
    }

    const range = req.headers.range;
    const parsed = parseFirstByteRange(range, size);

    const attachCloseHandlers = (stream) => {
      stream.on("error", () => {
        try {
          res.destroy();
        } catch (_e) {
          /* ignore */
        }
      });
    };

    if (parsed) {
      const { start, end } = parsed;
      const chunkLength = end - start + 1;
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": chunkLength,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        ...cacheHeaders,
      });
      const stream = fs.createReadStream(filePath, { start, end });
      attachCloseHandlers(stream);
      stream.pipe(res);
      return;
    }

    if (range) {
      res.writeHead(416, {
        "Content-Range": `bytes */${size}`,
        ...cacheHeaders,
      });
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": size,
      "Accept-Ranges": "bytes",
      ...cacheHeaders,
    });
    const stream = fs.createReadStream(filePath);
    attachCloseHandlers(stream);
    stream.pipe(res);
  });
}

function sendJson(res, status, payload) {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

/** Broadcast raw JSON string to every open WebSocket (display + controller). */
function broadcastWs(text) {
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(text);
    }
  }
}

/** Validate body and broadcast; returns true if accepted. */
function relayLangStep(body, httpRes) {
  const step = body.step;
  const cmdType = body.type;
  if (cmdType !== "lang_step" || !Number.isInteger(step)) {
    if (httpRes) {
      sendJson(httpRes, 400, { error: "Invalid command payload" });
    }
    return false;
  }
  const text = JSON.stringify({ type: "lang_step", step });
  broadcastWs(text);
  if (httpRes) {
    sendJson(httpRes, 200, { ok: true });
  }
  return true;
}

/** IPv4 LAN addresses (exclude loopback / link-local when possible). */
function listLanIpv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family;
      const isV4 = family === "IPv4" || family === 4;
      if (!isV4 || net.internal) {
        continue;
      }
      out.push({ address: net.address, iface: name });
    }
  }
  return out;
}

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const text = raw.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type !== "lang_step" || !Number.isInteger(msg.step)) {
      return;
    }
    broadcastWs(text);
  });
});

const server = http.createServer(async (req, res) => {
  if (await exhibitConnect.handleRequest(req, res)) {
    return;
  }

  const urlPath = req.url.split("?")[0];
  if (VENDOR[urlPath]) {
    sendStaticFile(req, res, VENDOR[urlPath], urlPath);
    return;
  }

  if (urlPath === "/__relay_ok") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
    });
    res.end("invisible-violence-relay");
    return;
  }

  if (urlPath === "/api/lan" && req.method === "GET") {
    const addresses = listLanIpv4();
    sendJson(res, 200, {
      port: PORT,
      addresses,
      urls: addresses.map((a) => ({
        display: `http://${a.address}:${PORT}/index.html`,
        controller: `http://${a.address}:${PORT}/controller.html`,
        iface: a.iface,
      })),
    });
    return;
  }

  if (urlPath === "/api/mapping" && req.method === "GET") {
    const fp = mappingPath();
    fs.readFile(fp, "utf8", (err, raw) => {
      if (err) {
        if (err.code === "ENOENT") {
          sendJson(res, 404, {
            error: "mapping file not found",
            path: MAPPING_FILENAME,
          });
        } else {
          sendJson(res, 500, { error: String(err.message || err) });
        }
        return;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        sendJson(res, 500, {
          error: "mapping file is not valid JSON",
          path: MAPPING_FILENAME,
        });
        return;
      }
      sendJson(res, 200, data);
    });
    return;
  }

  if (urlPath === "/api/command" && req.method === "POST") {
    let buf = "";
    req.on("data", (chunk) => {
      buf += chunk;
      if (buf.length > 1e6) {
        req.socket.destroy();
      }
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(buf || "{}");
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }
      relayLangStep(body, res);
    });
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  let pathname = urlPath;
  if (pathname === "/") pathname = "/index.html";
  const safe = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    sendStaticFile(req, res, filePath, pathname);
  });
});

server.on("upgrade", (req, socket, head) => {
  const pathname = req.url.split("?")[0];
  if (pathname === "/ws" || pathname.startsWith("/ws/")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ipHint = "<this-machine-ip>";
  console.log(`Invisible Violence server http://0.0.0.0:${PORT}/`);
  console.log(`  Display:    http://${ipHint}:${PORT}/index.html`);
  console.log(`  Controller: http://${ipHint}:${PORT}/controller.html`);
  console.log(`  WebSocket:  ws://${ipHint}:${PORT}/ws`);
});
