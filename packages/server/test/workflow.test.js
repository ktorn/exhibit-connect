import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import dgram from "node:dgram";
import { decodeBeacon } from "@exhibit-connect/core";
import { createExhibitConnectService } from "../src/index.js";

function listenBeacon(port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("beacon timeout"));
    }, 8000);
    socket.on("message", (msg) => {
      const payload = decodeBeacon(msg.toString("utf8"));
      if (!payload) return;
      clearTimeout(timer);
      socket.close();
      resolve(payload);
    });
    socket.bind(port);
  });
}

function openProjectionSse(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}/__exhibit-connect/v1/projection`,
      (res) => {
        let buf = "";
        let settle;
        const codePromise = new Promise((r, j) => {
          settle = { r, j };
        });
        const timer = setTimeout(() => settle.j(new Error("sse timeout")), 8000);
        res.on("data", (chunk) => {
          buf += chunk.toString();
          const m = buf.match(/event: pairing-code\ndata: ({[^\n]+})/);
          if (m) {
            clearTimeout(timer);
            settle.r(JSON.parse(m[1]).code);
          }
        });
        resolve({ req, codePromise });
      },
    );
    req.on("error", reject);
  });
}

async function jsonReq(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("pairing HTTP workflow", () => {
  const httpPort = 18099;
  const beaconPort = 18098;
  let server;
  let service;

  before(async () => {
    process.env.EXHIBIT_CONNECT_TABLET_IDLE_MS = "400";
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-wf-"));
    service = createExhibitConnectService({
      exhibitId: "wf-test",
      displayName: "Workflow",
      httpPort,
      lanHost: "127.0.0.1",
      stateDir,
      beaconPort,
    });
    server = http.createServer(async (req, res) => {
      if (!(await service.handleRequest(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(httpPort, "127.0.0.1", r));
  });

  after(async () => {
    service.stop();
    await new Promise((r) => server.close(r));
  });

  it("discovers, pairs, then reconnects after idle", { timeout: 20_000 }, async () => {
    const beacon = await listenBeacon(beaconPort);
    assert.equal(beacon.mode, "discovery");

    const sse = await openProjectionSse(httpPort);
    const start = await jsonReq(httpPort, "POST", "/__exhibit-connect/v1/pair/start", {
      tabletId: "tab-1",
    });
    assert.equal(start.status, 200);
    const code = await sse.codePromise;
    sse.req.destroy();
    assert.match(code, /^\d{6}$/);

    const confirm = await jsonReq(httpPort, "POST", "/__exhibit-connect/v1/pair/confirm", {
      tabletId: "tab-1",
      code,
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.controllerPath, "/controller.html");

    const blocked = await jsonReq(httpPort, "POST", "/__exhibit-connect/v1/pair/start", {
      tabletId: "tab-2",
    });
    assert.equal(blocked.status, 409);

    await jsonReq(httpPort, "POST", "/__exhibit-connect/v1/tablet/ping", {
      tabletId: "tab-1",
    });

    await new Promise((r) => setTimeout(r, 700));
    const reconnect = await listenBeacon(beaconPort);
    assert.equal(reconnect.mode, "reconnect");
  });
});
