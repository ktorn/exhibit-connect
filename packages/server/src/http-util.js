/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extraHeaders]
 */
export function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Exhibit-Pin, X-Exhibit-Admin-Token",
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
export function readAuthToken(req) {
  const pinHeader = header(req, "x-exhibit-pin");
  const adminHeader = header(req, "x-exhibit-admin-token");
  const raw = header(req, "authorization");
  const bearer =
    raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
  return {
    pin: pinHeader,
    token: adminHeader || bearer,
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string | undefined} adminToken
 */
export function mutateAuthorized(req, adminToken) {
  if (!adminToken) return true;
  return readAuthToken(req).token === adminToken;
}

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

export { readJsonBody };

function header(req, name) {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? "";
  return typeof v === "string" ? v : "";
}
