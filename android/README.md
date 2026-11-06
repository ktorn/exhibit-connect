# Exhibit Connect kiosk APK

Fullscreen lock-task tablet app: UDP discovery, pairing code on the **main projection**, last-IP reconnect, WebView controller.

## Staff PIN and hidden exit

1. **First launch:** set a 4–8 digit PIN (not shown to visitors).
2. App stays fullscreen; Back does nothing.
3. **Exit:** five taps in the **top-right** corner (same place the old controller fullscreen gesture used), then enter the PIN.
4. Staff menu: Resume / **Settings** / Unpair / Exit app.

**Settings (and first run):** force **landscape / landscape flipped / portrait / portrait flipped**. The stand is fixed, so the accelerometer is not used.

Swipe-down from the top (status bar / notifications) is **fully blocked only when the app is device owner**. Without that, Android still allows a system shade gesture.

True lock-task (no Recents/Home, no status bar) after device owner:

```bash
adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver
```

Requires no Google accounts on the tablet. Boot completed relaunches the app.

## Install on a tablet (no USB)

Download the debug APK (no secrets; PIN is set on first launch):

https://github.com/ktorn/exhibit-connect/raw/main/android/apk/exhibit-connect-debug.apk

On the tablet: Chrome → that URL → allow **Install unknown apps** for Chrome.

### Wireless adb (device owner / no status-bar swipe)

Same Wi‑Fi as your Mac. On the tablet: **Settings → Developer options → Wireless debugging** → Pair with pairing code, then:

```bash
adb pair <tablet-ip>:<pairing-port>
adb connect <tablet-ip>:<adb-port>
adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver
```

`dpm` needs a factory-reset tablet with **no Google account**.

## Build / emulator

```bash
cd android
./gradlew :app:installDebug
```

Emulator reaches the host exhibit at `10.0.2.2:8899` (UDP broadcast often does not cross the emulator NAT; the app also probes that host).
