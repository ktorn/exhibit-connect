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

Lock-task tablet app: first-run staff PIN, forced stand orientation (no sensor), pairing code on the **main projection**, last-IP reconnect, WebView controller. Back does nothing. **Exit:** five taps **top-right**, then the PIN. Staff menu: Resume / Settings / Unpair / Exit app.

More detail: [android/README.md](./android/README.md).

### Download (no USB)

The APK contains **no secrets** (no tokens, passwords, or SSH keys). The staff PIN is chosen on first launch and stored only on that tablet.

On the tablet, open Chrome and download:

**[exhibit-connect-debug.apk](https://github.com/ktorn/exhibit-connect/raw/main/android/apk/exhibit-connect-debug.apk)**

Allow **Install unknown apps** for Chrome, then install. This is a debug-signed build (gallery sideload, not Play Store).

### Wireless adb (optional, no USB cable)

Needed only if you want **device owner** so visitors cannot swipe down the status bar / notifications. Same Wi‑Fi as your Mac. Tablet: **Settings → Developer options → Wireless debugging → Pair with pairing code**.

```bash
adb pair <tablet-ip>:<pairing-port>
adb connect <tablet-ip>:<adb-port>
adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver
```

`dpm` requires a factory-reset tablet with **no Google account**. Pairing and kiosk work without this step; the shade stays swipeable until device owner is set.
