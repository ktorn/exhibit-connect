import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSidecarServer } from "@exhibit-connect/server";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.argv[2] ?? path.join(here, "exhibit-connect.example.json");
const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

startSidecarServer({
  ...config,
  adminToken: config.adminToken || undefined,
});
