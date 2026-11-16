# exhibit-connect protocol v1

LAN-only. No cloud registry for venue IPs.

## Goals

- Reusable across exhibits (metadata + controller URL differ per piece).
- **One tablet per PC.**
- **Discovery** allows **new** pairing only when the PC has no paired tablet.
- After pairing, discovery stays off; if the tablet drops, the PC **reconnect beacons** (same metadata, `mode: reconnect`) so the tablet can find the IP again.
- Pairing **code** is shown on the **main projection**; the operator types it on the tablet.
- Tablet keeps **last good IP** and tries it first; listens for beacons if unreachable.

## Roles

Devices are optional roles. Pairing is unchanged when a tablet is used.

| Role | What it is |
| --- | --- |
| **Host** | Serves pairing (if any) and the content API. Today: Node on a PC/NUC (`@exhibit-connect/server`). |
| **Display** | Visitor-facing surface (projection, WebView, or video). May be the same box as the host (standalone Android kiosk). |
| **Controller** | Optional gallery tablet. One controller per host. |
| **Manager** | Staff browser on the LAN that calls the per-device content API. Not a cloud catalog. Watchdog may wrap this later. |

Standalone displays **do not** send pairing beacons. Android **does not** host pairing/UDP/SSE in this version (deferred). Interactive pieces still use a PC host.

The kiosk APK picks **Tablet** vs **Display** on first run (same package `org.usj.exhibitconnect`).

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

## HTTP API (host)

Prefix: `/__exhibit-connect/v1`

All JSON responses. Errors: `{ "error": "code", "message": "..." }`. CORS is open for the LAN manager UI.

Mutating **content** routes require auth when configured:

- Node: `Authorization: Bearer <adminToken>` or `X-Exhibit-Admin-Token` if `adminToken` is set; otherwise LAN-trust (same as pairing).
- Android display: staff PIN via `X-Exhibit-Pin` (or the same value as Bearer).

`GET /status` includes `auth.mutate`: `"none"` | `"token"` | `"pin"`.

### `GET /status`

LAN debugging and tablet reachability checks.

```json
{
  "v": 1,
  "exhibitId": "...",
  "displayName": "...",
  "role": "host",
  "capabilities": ["pairing", "content"],
  "auth": { "mutate": "none" },
  "paired": true,
  "pairedTabletId": "uuid",
  "discoveryEnabled": false,
  "tabletConnected": true,
  "pairing": null,
  "lanHost": "10.20.85.226",
  "httpBase": "http://10.20.85.226:8899",
  "controllerPath": "/controller.html",
  "content": { "current": null, "itemCount": 0 }
}
```

Android display hosts report `role: "display"` and `capabilities: ["content"]`.

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

Clears paired tablet and re-enters discovery. For gallery staff / SSH maintenance. Header token is also accepted.

## Content API

Per-device media. There is **no** central CMS; each host stores its own files. Staff UI: `@exhibit-connect/manager` (also `GET /__exhibit-connect/v1/manager`). Sidecar also serves `/` as the manager page.

Upload cap: 512 MiB. Allowed types: mp4/webm/mov, images, html/css/js/json/plain.

### `GET /content`

```json
{
  "v": 1,
  "items": [
    { "id": "uuid", "type": "file", "name": "loop.mp4", "mime": "video/mp4", "size": 123, "url": "http://10.20.85.226:41235/__exhibit-connect/v1/content/files/uuid", "createdAt": "ISO" },
    { "id": "uuid", "type": "url", "name": "Piece", "url": "http://10.20.85.226:8899/" }
  ],
  "current": { "type": "url", "id": "uuid", "url": "http://10.20.85.226:8899/" },
  "maxUploadBytes": 536870912
}
```

### `POST /content/files`

`multipart/form-data` field `file`. Returns `{ "ok": true, "item": {…} }`. Then `PUT /content/current` to show it.

### `POST /content/urls`

Body: `{ "url": "http://…", "name": "optional", "current": true }`. `current` defaults true.

### `PUT /content/current`

- `{ "type": "url", "url": "http://…" }`
- `{ "type": "file", "id": "uuid" }`
- `{ "type": "none" }` — stop showing (keep stored items)

### `DELETE /content/:id`

Removes an item; clears `current` if it was showing that item.

### `GET /content/files/:id`

Serves the uploaded bytes (`Accept-Ranges`). Public so the kiosk WebView/VideoView can load it.

## Tablet behaviour (reference)

1. Listen for `v:1` beacons; show list with `displayName`, `student`, `mode`.
2. User selects a **discovery** beacon → `POST /pair/start` → prompt for code → `POST /pair/confirm`.
3. Store `exhibitId`, `controllerUrl`, `lastHttpBase` locally.
4. On launch: open `lastHttpBase` + ping; on failure, scan beacons matching `exhibitId` or `reconnect` for same id.

## Display kiosk behaviour (reference)

1. First-run PIN + orientation + role **Display**.
2. Listen on LAN HTTP (default **41235**) for the content API; do not pair or send beacons.
3. If `current` is a video file, loop it fullscreen; otherwise load the URL in a WebView (including a PC `httpBase` for a dumb Android display).
4. Idle (no current content): black screen with the manager URL for staff.
5. Exit: five taps top-right + PIN. Staff: Resume / Settings / Clear content / Exit.

## Security note

v1 trusts the venue LAN. The pairing code is short-lived and visible on the projection to prevent casual pairing. Content mutate uses an optional admin token (Node) or the on-device staff PIN (Android). Not intended for hostile networks.

## Deferred

Android as a **pairing host** (tablet pairs to an Android exhibit with no PC: Kotlin beacon sender, pairing HTTP, projection SSE) is **not** implemented. Keep a PC/NUC for interactive tablet pieces.
