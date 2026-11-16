import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createExhibitConnectService } from "../src/index.js";

const PREFIX = "/__exhibit-connect/v1";

async function req(port, method, urlPath, { json, raw, headers } = {}) {
  return new Promise((resolve, reject) => {
    const body = raw ?? (json ? Buffer.from(JSON.stringify(json)) : null);
    const reqHeaders = { ...headers };
    if (json) reqHeaders["Content-Type"] = "application/json";
    if (body) reqHeaders["Content-Length"] = String(body.length);
    const r = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          let parsed = text;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            /* keep string */
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, buf });
        });
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function multipart(filename, data, mime) {
  const boundary = "----ecTestBoundary";
  const raw = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    raw,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("content API", () => {
  const httpPort = 18199;
  let server;
  let service;
  const adminToken = "test-admin";

  before(async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-content-"));
    service = createExhibitConnectService({
      exhibitId: "content-test",
      displayName: "Content",
      httpPort,
      lanHost: "127.0.0.1",
      stateDir,
      beaconPort: 18198,
      adminToken,
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

  it("exposes content capability and manager page", async () => {
    const status = await req(httpPort, "GET", `${PREFIX}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.role, "host");
    assert.deepEqual(status.body.capabilities, ["pairing", "content"]);
    assert.equal(status.body.auth.mutate, "token");

    const page = await req(httpPort, "GET", `${PREFIX}/manager`);
    assert.equal(page.status, 200);
    assert.match(page.buf.toString(), /Exhibit content/);
  });

  it("rejects mutate without token, then upload/show/delete", async () => {
    const denied = await req(httpPort, "POST", `${PREFIX}/content/urls`, {
      json: { url: "http://127.0.0.1/x" },
    });
    assert.equal(denied.status, 401);

    const auth = { Authorization: `Bearer ${adminToken}` };
    const urlAdd = await req(httpPort, "POST", `${PREFIX}/content/urls`, {
      json: { url: "http://127.0.0.1:8899/index.html", name: "IV" },
      headers: auth,
    });
    assert.equal(urlAdd.status, 201);
    assert.equal(urlAdd.body.content.current.url, "http://127.0.0.1:8899/index.html");

    const part = multipart("hello.html", "<h1>Hi</h1>", "text/html");
    const up = await req(httpPort, "POST", `${PREFIX}/content/files`, {
      raw: part.raw,
      headers: { ...auth, ...part.headers },
    });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const id = up.body.item.id;

    const shown = await req(httpPort, "PUT", `${PREFIX}/content/current`, {
      json: { type: "file", id },
      headers: auth,
    });
    assert.equal(shown.status, 200);
    assert.match(shown.body.content.current.url, new RegExp(id));

    const file = await req(httpPort, "GET", `${PREFIX}/content/files/${id}`);
    assert.equal(file.status, 200);
    assert.equal(file.buf.toString(), "<h1>Hi</h1>");

    const ranged = await req(httpPort, "GET", `${PREFIX}/content/files/${id}`, {
      headers: { Range: "bytes=0-2" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.buf.toString(), "<h1");

    const del = await req(httpPort, "DELETE", `${PREFIX}/content/${id}`, { headers: auth });
    assert.equal(del.status, 200);
    assert.equal(del.body.content.current, null);

    const gone = await req(httpPort, "GET", `${PREFIX}/content/files/${id}`);
    assert.equal(gone.status, 404);
  });
});
