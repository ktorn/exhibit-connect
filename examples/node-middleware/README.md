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

Sidecar mode (`examples/sidecar/`) avoids touching the exhibit server when you only need pairing on a separate port; the tablet must reach both ports on the LAN unless you proxy `/__exhibit-connect/*` through the main server.
