import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";

/**
 * Stream `req` to a temp file (enforces maxBytes).
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 */
export async function bufferRequestToTemp(req, maxBytes) {
  const tmp = path.join(os.tmpdir(), `ec-upload-${randomUUID()}`);
  let size = 0;
  const ws = fs.createWriteStream(tmp);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        ws.destroy();
        await fsp.unlink(tmp).catch(() => {});
        const err = new Error("too_large");
        err.code = "too_large";
        throw err;
      }
      if (!ws.write(chunk)) {
        await new Promise((resolve, reject) => {
          ws.once("drain", resolve);
          ws.once("error", reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      ws.end(() => resolve());
      ws.once("error", reject);
    });
  } catch (err) {
    ws.destroy();
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  return { tmp, size };
}

/**
 * Pull the first file part out of a multipart body on disk.
 * @param {string} tempPath
 * @param {string} contentType
 * @param {string} destPath
 */
export async function extractMultipartFile(tempPath, contentType, destPath) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) {
    const err = new Error("multipart boundary missing");
    err.code = "not_multipart";
    throw err;
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  const stat = await fsp.stat(tempPath);
  const fd = await fsp.open(tempPath, "r");
  try {
    const headLen = Math.min(stat.size, 64 * 1024);
    const head = Buffer.alloc(headLen);
    await fd.read(head, 0, headLen, 0);

    const sep = Buffer.from("\r\n\r\n");
    const sepAt = indexOf(head, sep);
    if (sepAt < 0) {
      const err = new Error("multipart headers missing");
      err.code = "not_multipart";
      throw err;
    }
    const headerText = head.subarray(0, sepAt).toString("utf8");
    const filenameMatch = /filename\*=(?:UTF-8'')?([^;\r\n]+)|filename="([^"]+)"|filename=([^;\r\n]+)/i.exec(
      headerText,
    );
    const filenameRaw = decodeURIComponent(
      (filenameMatch?.[1] || filenameMatch?.[2] || filenameMatch?.[3] || "file").trim(),
    );
    const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    const mime = mimeMatch?.[1]?.trim();

    const dataStart = sepAt + 4;
    const tailLen = Math.min(stat.size, 64 * 1024);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, stat.size - tailLen);
    const endToken = Buffer.from(`\r\n--${boundary}`);
    let rel = lastIndexOf(tail, endToken);
    if (rel < 0) {
      const err = new Error("multipart terminator missing");
      err.code = "not_multipart";
      throw err;
    }
    const dataEnd = stat.size - tailLen + rel; // exclusive
    if (dataEnd < dataStart) {
      const err = new Error("empty multipart file");
      err.code = "not_multipart";
      throw err;
    }

    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const rs = fs.createReadStream(tempPath, { start: dataStart, end: dataEnd - 1 });
    const ws = fs.createWriteStream(destPath);
    await pipeline(rs, ws);
    return {
      filename: filenameRaw,
      mime,
      size: dataEnd - dataStart,
    };
  } finally {
    await fd.close();
  }
}

function indexOf(buf, seq) {
  return buf.indexOf(seq);
}

function lastIndexOf(buf, seq) {
  return buf.lastIndexOf(seq);
}
