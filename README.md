# exhibit-connect

LAN pairing and reconnect for gallery tablets and exhibit PCs, plus a per-device content API for simple displays. One tablet per host when a controller is used; pairing code on the main projection; tablet stores last IP and falls back to UDP beacons when unreachable.

This repo is **not** fleet ops (WireGuard, remote SSH) and **not** a central CMS. See [exhibition-watchdog](https://github.com/ktorn/exhibition-watchdog) for remote reach. Content lives on each host; `@exhibit-connect/manager` is a LAN client.

## Packages

| Package | Role |
| --- | --- |
| `@exhibit-connect/core` | Protocol types, beacon codec, pairing state, content helpers |
| `@exhibit-connect/server` | HTTP pairing + content API + UDP beacon loop |
| `@exhibit-connect/projection` | Browser overlay for pairing code on the main display |
| `@exhibit-connect/manager` | LAN staff UI for per-device URL/file content |
| `@exhibit-connect/tablet-web` | Web tablet pairing (dev / Playwright) |

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

Sidecar also serves the content manager at `http://<lan>:41235/`.

**Signage remote (laptop on gallery Wi‑Fi):**

```bash
npm run manager
# open http://127.0.0.1:4173/
```

Display kiosks advertise themselves. Click a screen, enter the staff PIN, paste a Figma/exhibit URL. Do not type URLs on the kiosk. Off-site control is exhibition-watchdog, not this repo.

## Android kiosk

One APK, two roles (first run, or Settings):

- **Tablet** — pairing code on the **main projection**, last-IP reconnect, WebView controller. Staff: Resume / Settings / Unpair / Exit.
- **Display** — standalone web/video kiosk; skips pairing; LAN content API (default port 41235). Staff: Resume / Settings / Clear content / Exit. Point the manager UI at the URL on the idle screen, or load a PC `httpBase` as the current URL.

First-run staff PIN, forced stand orientation (no sensor). Back does nothing. **Exit:** five taps **top-right**, then the PIN.

More detail: [android/README.md](./android/README.md).

### Download (no USB)

The APK contains **no secrets** (no tokens, passwords, or SSH keys). The staff PIN is chosen on first launch and stored only on that tablet.

On the tablet, open Chrome and download the APK from the latest **[GitHub Release](https://github.com/ktorn/exhibit-connect/releases/latest)**. Direct file:

**[exhibit-connect-debug.apk](https://github.com/ktorn/exhibit-connect/releases/latest/download/exhibit-connect-debug.apk)**

Allow **Install unknown apps** for Chrome, then install. This is a debug-signed build (gallery sideload, not Play Store).

### Wireless adb (optional, no USB cable)

Needed only if you want **device owner** so visitors cannot swipe down the status bar / notifications. Same Wi‑Fi as your Mac. Tablet: **Settings → Developer options → Wireless debugging → Pair with pairing code**.

```bash
adb pair <tablet-ip>:<pairing-port>
adb connect <tablet-ip>:<adb-port>
adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver
```

`dpm` requires a factory-reset tablet with **no Google account**. Pairing and kiosk work without this step; the shade stays swipeable until device owner is set.
