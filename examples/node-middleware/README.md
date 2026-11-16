# Node middleware

Mount exhibit-connect on an existing `http.Server` (e.g. `server.mjs` on port 8899).

```javascript
import http from "node:http";
import { createExhibitConnectService } from "@exhibit-connect/server";

const exhibitConnect = createExhibitConnectService({
  exhibitId: "invisible-violence-2026",
  displayName: "Invisible Violence",
  httpPort: 8899,
  controllerPath: "/controller.html",
});

const server = http.createServer(async (req, res) => {
  if (await exhibitConnect.handleRequest(req, res)) return;
  // ... existing static + WebSocket handling
});
```

Serve `@exhibit-connect/projection` as a static file and import it from `index.html` so the pairing code appears on the main projection.

The same `handleRequest` also serves the per-device content API and the staff manager at `/__exhibit-connect/v1/manager`. Point `@exhibit-connect/manager` at this host to upload a file or pin a URL. Do not fold fleet remote admin here — exhibition-watchdog can call the same API later.

Sidecar mode (`examples/sidecar/`) avoids touching the exhibit server when you only need pairing on a separate port; the tablet must reach both ports on the LAN unless you proxy `/__exhibit-connect/*` through the main server.
