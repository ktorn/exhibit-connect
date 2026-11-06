# exhibit-connect protocol v1

LAN-only. No cloud registry for venue IPs.

## Goals

- Reusable across exhibits (metadata + controller URL differ per piece).
- **One tablet per PC.**
- **Discovery** allows **new** pairing only when the PC has no paired tablet.
- After pairing, discovery stays off; if the tablet drops, the PC **reconnect beacons** (same metadata, `mode: reconnect`) so the tablet can find the IP again.
- Pairing **code** is shown on the **main projection**; the operator types it on the tablet.
- Tablet keeps **last good IP** and tries it first; listens for beacons if unreachable.

## UDP beacon

- Multicast optional; default **broadcast** `255.255.255.255`.
- Port: **41234** (configurable).
- Payload: UTF-8 JSON, max 1400 bytes.

```json
{
  "v": 1,
  "exhibitId": "invisible-violence-2026",
  "displayName": "Invisible Violence",
  "student": "Mary",
  "httpPort": 8899,
  "controllerPath": "/controller.html",
  "lanHost": "10.20.85.226",
  "mode": "discovery",
  "httpBase": "http://10.20.85.226:8899",
  "pairingBase": "http://10.20.85.226:41235"
}
```

`mode`:

| Value | When |
| --- | --- |
| `discovery` | No paired tablet; new pairing allowed |
| `reconnect` | Paired tablet absent; no new pairing |
| *(absent)* | Do not broadcast (paired tablet recently active) |

`httpBase` is the URL the tablet should open for the controller (scheme + host + port, no path).

`pairingBase` is where `/__exhibit-connect/v1/*` lives when using a sidecar; omit it when those routes are on the same server as the exhibit.

## HTTP API (PC)

Prefix: `/__exhibit-connect/v1`

All responses JSON. Errors: `{ "error": "code", "message": "..." }`.

### `GET /status`

LAN debugging and tablet reachability checks.

```json
{
  "v": 1,
  "exhibitId": "...",
  "paired": true,
  "pairedTabletId": "uuid",
  "discoveryEnabled": false,
  "tabletConnected": true,
  "pairing": null,
  "lanHost": "10.20.85.226",
  "httpBase": "http://10.20.85.226:8899"
}
```

When a pairing is in progress, `pairing: { "expiresAt": "ISO", "codeLength": 6 }` (code is **not** returned here).

### `GET /projection`

Server-Sent Events for the main display. Events:

- `pairing-code` — `data: {"code":"482913","expiresAt":"..."}`
- `pairing-cleared` — `data: {}`
- `tablet-connected` — `data: {"tabletId":"..."}`

### `POST /pair/start`

Body: `{ "tabletId": "uuid" }`

Only succeeds when `mode` would be `discovery` (no paired tablet).

Starts a short-lived pairing; pushes `pairing-code` to projection subscribers. Returns:

```json
{ "ok": true, "expiresInSec": 300 }
```

### `POST /pair/confirm`

Body: `{ "tabletId": "uuid", "code": "482913" }`

On success, persists paired tablet, clears pairing code, stops discovery beacons. Returns:

```json
{
  "ok": true,
  "httpBase": "http://10.20.85.226:8899",
  "controllerPath": "/controller.html",
  "controllerUrl": "http://10.20.85.226:8899/controller.html"
}
```

### `POST /tablet/ping`

Body: `{ "tabletId": "uuid" }`

From the paired tablet only (matches stored id). Refreshes `tabletConnected` and suppresses reconnect beacons. Returns `{ "ok": true }`.

### `POST /pair/reset`

Body: `{ "adminToken": "..." }` optional if configured.

Clears paired tablet and re-enters discovery. For gallery staff / SSH maintenance.

## Tablet behaviour (reference)

1. Listen for `v:1` beacons; show list with `displayName`, `student`, `mode`.
2. User selects a **discovery** beacon → `POST /pair/start` → prompt for code → `POST /pair/confirm`.
3. Store `exhibitId`, `controllerUrl`, `lastHttpBase` locally.
4. On launch: open `lastHttpBase` + ping; on failure, scan beacons matching `exhibitId` or `reconnect` for same id.

## Security note

v1 trusts the venue LAN. The pairing code is short-lived and visible on the projection to prevent casual pairing. Not intended for hostile networks.
