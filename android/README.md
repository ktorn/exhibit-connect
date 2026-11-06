# Android kiosk (planned)

Generic gallery tablet app:

1. UDP listen on beacon port **41234**; list `discovery` and matching `reconnect` entries.
2. User selects a PC → `POST http://{lanHost}:{pairingPort}/__exhibit-connect/v1/pair/start`.
3. Prompt for code → `POST .../pair/confirm` → persist `controllerUrl` and `lastHttpBase`.
4. WebView loads `controllerUrl`; background task sends `POST .../tablet/ping` every 15s.
5. On cold start, try `lastHttpBase` first; if unreachable, return to beacon scan.

`pairingPort` defaults to **41235** (sidecar) or the exhibit HTTP port when middleware is mounted on the same server.
