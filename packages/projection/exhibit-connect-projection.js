/**
 * Drop on the main projection page. Shows pairing code overlay via SSE.
 *
 * <script type="module">
 *   import { attachProjectionOverlay } from '/path/to/exhibit-connect-projection.js';
 *   attachProjectionOverlay({ baseUrl: '' }); // same origin as exhibit HTTP server
 * </script>
 */

/**
 * @param {{ baseUrl?: string; mount?: HTMLElement }} [opts]
 */
export function attachProjectionOverlay(opts = {}) {
  const base = (opts.baseUrl ?? "").replace(/\/$/, "");
  const mount = opts.mount ?? document.body;

  const layer = document.createElement("div");
  layer.setAttribute("data-exhibit-connect-overlay", "1");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    zIndex: "2147483646",
    pointerEvents: "none",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    textAlign: "center",
    padding: "2rem 3rem",
    borderRadius: "12px",
    background: "rgba(20,20,24,0.95)",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
  });

  const title = document.createElement("div");
  title.textContent = "Tablet pairing code";
  Object.assign(title.style, { fontSize: "1.25rem", opacity: "0.85", marginBottom: "1rem" });

  const codeEl = document.createElement("div");
  Object.assign(codeEl.style, {
    fontSize: "4rem",
    fontWeight: "700",
    letterSpacing: "0.35em",
    fontVariantNumeric: "tabular-nums",
  });

  const hint = document.createElement("div");
  hint.textContent = "Enter this code on the gallery tablet";
  Object.assign(hint.style, { marginTop: "1rem", fontSize: "1rem", opacity: "0.7" });

  card.append(title, codeEl, hint);
  layer.append(card);
  mount.append(layer);

  const es = new EventSource(`${base}/__exhibit-connect/v1/projection`);

  es.addEventListener("pairing-code", (ev) => {
    try {
      const data = JSON.parse(/** @type {MessageEvent} */ (ev).data);
      codeEl.textContent = String(data.code ?? "");
      layer.style.display = "flex";
    } catch {
      /* ignore */
    }
  });

  es.addEventListener("pairing-cleared", () => {
    layer.style.display = "none";
    codeEl.textContent = "";
  });

  es.onerror = () => {
    /* EventSource retries; overlay stays hidden until code event */
  };

  return () => {
    es.close();
    layer.remove();
  };
}

if (typeof window !== "undefined") {
  /** @type {Window & { ExhibitConnectProjection?: { attach: typeof attachProjectionOverlay } }} */
  const w = window;
  w.ExhibitConnectProjection = { attach: attachProjectionOverlay };
}
