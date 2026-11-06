import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8899;
const stateDir = path.join(os.tmpdir(), "exhibit-connect-e2e-state");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `rm -rf ${JSON.stringify(stateDir)} && node examples/invisible-violence/server.mjs`,
    cwd: root,
    url: `http://127.0.0.1:${port}/__relay_ok`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(port),
      EXHIBIT_CONNECT_LAN_HOST: "127.0.0.1",
      EXHIBIT_CONNECT_STATE_DIR: stateDir,
      EXHIBIT_CONNECT_BEACON_PORT: "41299",
      EXHIBIT_CONNECT_TABLET_IDLE_MS: "800",
    },
  },
});
