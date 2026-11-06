# exhibit-connect

LAN pairing and reconnect for gallery tablets and exhibit PCs. One tablet per PC; pairing code on the main projection; tablet stores last IP and falls back to UDP beacons when unreachable.

This repo is **not** fleet ops (WireGuard, remote SSH). See [exhibition-watchdog](https://github.com/ktorn/exhibition-watchdog) for that.

## Packages

| Package | Role |
| --- | --- |
| `@exhibit-connect/core` | Protocol types, beacon codec, pairing state |
| `@exhibit-connect/server` | HTTP pairing API + UDP beacon loop |
| `@exhibit-connect/projection` | Browser overlay for pairing code on the main display |

## Quick start (sidecar)

```bash
cp examples/sidecar/exhibit-connect.example.json exhibit-connect.json
# edit exhibitId, ports, paths
node examples/sidecar/run.mjs
```

Integrate into an existing Node HTTP server with `@exhibit-connect/server` middleware (see `examples/node-middleware/`).

## Protocol

See [docs/protocol.md](./docs/protocol.md).

## Tests

```bash
npm test          # core + HTTP/UDP workflow
npx playwright test   # Invisible Violence projection + tablet UI (Chromium)
```

Local fixture: `examples/invisible-violence` (student piece without large videos).

## Android kiosk

`android/` is a lock-task APK: first-run staff PIN, fullscreen WebView, five taps **top-right** then PIN to leave. See [android/README.md](./android/README.md).

Download: [android/apk/exhibit-connect-debug.apk](https://github.com/ktorn/exhibit-connect/raw/main/android/apk/exhibit-connect-debug.apk)
