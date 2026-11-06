# Exhibit Connect kiosk APK

Fullscreen lock-task tablet app: UDP discovery, pairing code on the **main projection**, last-IP reconnect, WebView controller.

## Staff PIN and hidden exit

1. **First launch:** set a 4–8 digit PIN (not shown to visitors).
2. App stays fullscreen; Back does nothing.
3. **Exit:** five taps in the **top-right** corner (same place the old controller fullscreen gesture used), then enter the PIN.
4. Staff menu: Resume / Unpair / Exit app.

True lock-task (visitor cannot use Recents/Home) after device owner:

```bash
adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver
```

Requires no Google accounts on the tablet. Boot completed relaunches the app.

## Build / emulator

```bash
cd android
./gradlew :app:installDebug
```

Emulator reaches the host exhibit at `10.0.2.2:8899` (UDP broadcast often does not cross the emulator NAT; the app also probes that host).
