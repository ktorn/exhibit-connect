import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decorateContentState,
  filePublicPath,
  isAllowedContentUrl,
  isContentId,
  resolveCurrentUrl,
  resolveUploadMime,
  sanitizeFilename,
} from "../src/content.js";

describe("content helpers", () => {
  it("sanitizes names and resolves mime from filename", () => {
    assert.equal(sanitizeFilename("../x/y z.mp4"), "y z.mp4");
    assert.equal(resolveUploadMime("loop.mp4", "application/octet-stream"), "video/mp4");
    assert.equal(resolveUploadMime("page.html", "text/html"), "text/html");
    assert.equal(resolveUploadMime("evil.exe", "application/x-msdownload"), null);
  });

  it("accepts http(s) content URLs only", () => {
    assert.equal(isAllowedContentUrl("http://10.0.0.5:8899/index.html"), true);
    assert.equal(isAllowedContentUrl("https://example.org/a"), true);
    assert.equal(isAllowedContentUrl("file:///tmp/x"), false);
    assert.equal(isAllowedContentUrl("javascript:alert(1)"), false);
  });

  it("builds public file URLs", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(isContentId(id), true);
    assert.equal(
      filePublicPath(id),
      `/__exhibit-connect/v1/content/files/${id}`,
    );
    assert.equal(
      resolveCurrentUrl({ type: "file", id }, "http://10.0.0.5:41235"),
      `http://10.0.0.5:41235/__exhibit-connect/v1/content/files/${id}`,
    );
  });

  it("decorates list payloads", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const out = decorateContentState(
      {
        items: [{ id, type: "file", name: "a.mp4", mime: "video/mp4" }],
        current: { type: "file", id },
      },
      "http://127.0.0.1:9/",
    );
    assert.equal(out.v, 1);
    assert.match(out.items[0].url, /\/content\/files\//);
    assert.equal(out.current.url, out.items[0].url);
  });
});
