import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PREFIX } from "@exhibit-connect/core";
import { corsHeaders } from "./http-util.js";

const managerDir = path.join(fileURLToPath(new URL(".", import.meta.url)), "../../manager");

const FILES = {
  html: path.join(managerDir, "manager.html"),
  js: path.join(managerDir, "manager.js"),
};

function mimeFor(kind) {
  return kind === "js"
    ? "text/javascript; charset=utf-8"
    : "text/html; charset=utf-8";
}

/**
 * @param {string} pathname
 * @returns {"html" | "js" | null}
 */
export function managerAssetKind(pathname) {
  const p = pathname.replace(/\/$/, "") || "/";
  if (
    p === "/" ||
    p === "/manager" ||
    p === "/manager.html" ||
    p === `${API_PREFIX}/manager` ||
    p === `${API_PREFIX}/manager.html`
  ) {
    return "html";
  }
  if (p === "/manager.js" || p === `${API_PREFIX}/manager.js`) {
    return "js";
  }
  return null;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {"html" | "js"} kind
 */
export function sendManagerAsset(res, kind) {
  const filePath = FILES[kind];
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, corsHeaders());
      res.end("Manager UI not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeFor(kind),
      "Content-Length": st.size,
      "Cache-Control": "no-store",
      ...corsHeaders(),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/**
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 */
export function tryServeManager(pathname, res) {
  const kind = managerAssetKind(pathname);
  if (!kind) return false;
  sendManagerAsset(res, kind);
  return true;
}
