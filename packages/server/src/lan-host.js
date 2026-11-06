import os from "node:os";

/**
 * Prefer a private IPv4 on a non-internal interface (venue LAN).
 * @returns {string | null}
 */
export function pickLanHost() {
  const nets = os.networkInterfaces();
  /** @type {string[]} */
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (lower.includes("loopback") || lower.startsWith("lo")) continue;
    for (const net of nets[name] ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      candidates.push(net.address);
    }
  }
  const venue = candidates.find((a) => a.startsWith("10.") || a.startsWith("192.168."));
  return venue ?? candidates[0] ?? null;
}
