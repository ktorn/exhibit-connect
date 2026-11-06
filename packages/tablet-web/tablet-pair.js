const STORAGE_KEY = "exhibit-connect-pairing-v1";

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function setStatus(text, isError = false) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.classList.toggle("err", isError);
}

function pairingApi(base) {
  return `${base.replace(/\/$/, "")}/__exhibit-connect/v1`;
}

async function fetchStatus(base) {
  const res = await fetch(`${pairingApi(base)}/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

async function tryLastIp(saved) {
  const base = saved.lastHttpBase || saved.pairingBase;
  if (!base) return false;
  setStatus(`Trying last IP ${base}…`);
  try {
    const st = await fetchStatus(base);
    if (st.paired && saved.tabletId && st.pairedTabletId === saved.tabletId) {
      await fetch(`${pairingApi(base)}/tablet/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabletId: saved.tabletId }),
      });
      window.location.href = saved.controllerUrl;
      return true;
    }
  } catch {
    setStatus("Last IP unreachable — looking for exhibit beacon via this host.");
  }
  return false;
}

function tabletId() {
  const saved = loadSaved();
  if (saved?.tabletId) return saved.tabletId;
  const id = crypto.randomUUID();
  save({ tabletId: id });
  return id;
}

/** @type {{ pairingBase: string, httpBase: string, tabletId: string } | null} */
let pending = null;

async function startPair(pairingBase, httpBase) {
  const id = tabletId();
  pending = { pairingBase, httpBase, tabletId: id };
  const res = await fetch(`${pairingApi(pairingBase)}/pair/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabletId: id }),
  });
  const body = await res.json();
  if (!res.ok) {
    setStatus(body.message || "Cannot start pairing", true);
    return;
  }
  document.getElementById("code-row").style.display = "block";
  setStatus("Enter the code shown on the main projection.");
}

async function confirmPair() {
  if (!pending) return;
  const code = /** @type {HTMLInputElement} */ (document.getElementById("code")).value.trim();
  const res = await fetch(`${pairingApi(pending.pairingBase)}/pair/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabletId: pending.tabletId, code }),
  });
  const body = await res.json();
  if (!res.ok) {
    setStatus(body.message || "Wrong code", true);
    return;
  }
  save({
    tabletId: pending.tabletId,
    lastHttpBase: body.httpBase,
    pairingBase: pending.pairingBase,
    controllerUrl: body.controllerUrl,
    exhibitId: body.exhibitId,
  });
  window.location.href = body.controllerUrl;
}

async function showDiscovered(base) {
  const st = await fetchStatus(base);
  const id = tabletId();
  if (st.paired && st.pairedTabletId === id) {
    const controllerUrl = `${st.httpBase}${st.controllerPath}`;
    await fetch(`${pairingApi(st.httpBase)}/tablet/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabletId: id }),
    });
    const saved = loadSaved() || {};
    save({
      ...saved,
      tabletId: id,
      lastHttpBase: st.httpBase,
      pairingBase: st.httpBase,
      controllerUrl,
      exhibitId: st.exhibitId,
    });
    window.location.href = controllerUrl;
    return;
  }

  const list = document.getElementById("pc-list");
  list.innerHTML = "";
  const pairingBase = st.httpBase;
  const label = `${st.displayName || st.exhibitId} (${st.discoveryEnabled ? "discovery" : "reconnect"})`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.dataset.exhibit = st.exhibitId;
  if (!st.discoveryEnabled) {
    btn.disabled = true;
    setStatus("PC is paired to another tablet.");
  } else {
    btn.addEventListener("click", () => startPair(pairingBase, st.httpBase));
    setStatus("Select the exhibit PC.");
  }
  list.append(btn);
}

document.getElementById("confirm").addEventListener("click", () => {
  confirmPair();
});

(async function main() {
  const saved = loadSaved();
  const id = tabletId();
  if (saved?.lastHttpBase) {
    const ok = await tryLastIp({ ...saved, tabletId: id });
    if (ok) return;
  }
  const originBase = window.location.origin;
  try {
    await showDiscovered(originBase);
  } catch (err) {
    setStatus(`No exhibit on this host: ${err instanceof Error ? err.message : err}`, true);
  }
})();
