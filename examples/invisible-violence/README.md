# Invisible Violence (local exhibit-connect fixture)

Copy of the Mary / Invisible Violence Node exhibit (`server.mjs` + projection + controller), with **videos omitted**. Used to develop and test `@exhibit-connect` pairing on a real piece.

From the repo root:

```bash
npm install
cd examples/invisible-violence && npm start
```

- Projection: http://127.0.0.1:8899/index.html (pairing code overlay)
- Tablet pairing UI: http://127.0.0.1:8899/tablet-pair.html
- Controller: http://127.0.0.1:8899/controller.html

State is stored under `examples/invisible-violence/.state/` (gitignored). Reset pairing: `POST /__exhibit-connect/v1/pair/reset`.
