const PREFIX = "/__exhibit-connect/v1";
const PIN_KEY = "exhibit-connect-manager-pin";
const LIMIT = 6 * 1024 * 1024 * 1024;

const el = {
  host: document.getElementById("host"),
  secret: document.getElementById("secret"),
  connect: document.getElementById("connect"),
  status: document.getElementById("status"),
  panel: document.getElementById("panel"),
  current: document.getElementById("current"),
  url: document.getElementById("url"),
  showUrl: document.getElementById("show-url"),
  file: document.getElementById("file"),
  upload: document.getElementById("upload"),
  list: document.getElementById("list"),
  clearCurrent: document.getElementById("clear-current"),
  screens: document.getElementById("screens"),
  screensEmpty: document.getElementById("screens-empty"),
  transfers: document.getElementById("transfers"),
  transferList: document.getElementById("transfer-list"),
};

if (!el.host.value) {
  el.host.value = window.location.origin;
}
const savedPin = localStorage.getItem(PIN_KEY);
if (savedPin && !el.secret.value) el.secret.value = savedPin;

/** @type {{ name: string, maxUploadBytes: number } | null} */
let session = null;
/** @type {Map<string, object>} */
const transfers = new Map();
let transferSeq = 0;

function base() {
  return String(el.host.value || "").replace(/\/$/, "");
}

function authHeaders(secret, extra = {}) {
  const token = (secret ?? el.secret.value).trim();
  if (token) localStorage.setItem(PIN_KEY, token);
  const headers = { ...extra };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-Exhibit-Pin"] = token;
    headers["X-Exhibit-Admin-Token"] = token;
  }
  return headers;
}

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.className = kind || "";
}

async function apiAt(host, method, path, { jsonBody, form, secret } = {}) {
  const headers = authHeaders(secret, jsonBody ? { "Content-Type": "application/json" } : {});
  const res = await fetch(`${host}${PREFIX}${path}`, {
    method,
    headers,
    body: form ?? (jsonBody ? JSON.stringify(jsonBody) : undefined),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(body.message || body.error || res.statusText);
  }
  return body;
}

function api(method, path, opts) {
  return apiAt(base(), method, path, opts);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function hostBusy(host) {
  for (const t of transfers.values()) {
    if (t.host === host && (t.state === "uploading" || t.state === "applying")) {
      return t;
    }
  }
  return null;
}

let transferPaint = 0;
function scheduleTransferPaint() {
  if (transferPaint) return;
  transferPaint = requestAnimationFrame(() => {
    transferPaint = 0;
    renderTransfers();
  });
}

function renderTransfers() {
  if (!el.transferList) return;
  const items = [...transfers.values()].reverse();
  el.transfers.style.display = items.length ? "block" : "none";
  el.transferList.replaceChildren();
  for (const t of items) {
    const wrap = document.createElement("div");
    wrap.className = "xfer";
    const title = document.createElement("div");
    title.textContent = `${t.displayName} ← ${t.fileName}`;
    const meta = document.createElement("div");
    meta.className = "xfer-meta";
    const pct = t.total ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0;
    if (t.state === "uploading") {
      meta.textContent = `Uploading ${formatBytes(t.loaded)} / ${formatBytes(t.total)} (${pct}%)`;
    } else if (t.state === "applying") {
      meta.textContent = "Upload complete. Showing on screen…";
    } else if (t.state === "done") {
      meta.textContent = "Done — now showing on that screen.";
      meta.classList.add("ok");
    } else if (t.state === "cancelled") {
      meta.textContent = "Cancelled.";
    } else {
      meta.textContent = t.error || "Failed";
      meta.classList.add("err");
    }
    wrap.append(title, meta);
    if (t.state === "uploading" || t.state === "applying") {
      const bar = document.createElement("progress");
      bar.max = 100;
      bar.value = t.state === "applying" ? 100 : pct;
      wrap.append(bar);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        t.xhr?.abort();
      });
      wrap.append(cancel);
    }
    el.transferList.append(wrap);
  }
}

function render(content) {
  const current = content.current;
  el.current.textContent = current?.url || "None";
  el.list.replaceChildren();
  for (const item of content.items || []) {
    const li = document.createElement("li");
    if (current && (current.id === item.id || current.url === item.url)) {
      li.className = "current";
    }
    const label = document.createElement("span");
    label.textContent = `${item.name} (${item.type})`;
    const show = document.createElement("button");
    show.type = "button";
    show.textContent = "Show";
    show.addEventListener("click", () => showItem(item));
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", () => removeItem(item.id));
    li.append(label, show, del);
    el.list.append(li);
  }
}

async function refresh() {
  const content = await api("GET", "/content");
  if (typeof content.maxUploadBytes === "number" && content.maxUploadBytes > 0 && session) {
    session.maxUploadBytes = content.maxUploadBytes;
  }
  render(content);
  return content;
}

async function connect() {
  try {
    const status = await api("GET", "/status");
    const auth = status.auth?.mutate || "none";
    const who = status.displayName || status.exhibitId || "host";
    session = {
      name: who,
      maxUploadBytes: LIMIT,
    };
    setStatus(`Connected to ${who} (${status.role || "host"}; auth ${auth}).`, "ok");
    el.panel.style.display = "block";
    await refresh();
  } catch (err) {
    session = null;
    el.panel.style.display = "none";
    setStatus(err instanceof Error ? err.message : "Connect failed", "err");
  }
}

async function showItem(item) {
  try {
    const spec =
      item.type === "file"
        ? { type: "file", id: item.id }
        : { type: "url", url: item.url };
    const out = await api("PUT", "/content/current", { jsonBody: spec });
    render(out.content);
    setStatus("Now showing " + (out.content.current?.url || item.name), "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Show failed", "err");
  }
}

async function removeItem(id) {
  try {
    const out = await api("DELETE", `/content/${id}`);
    render(out.content);
    setStatus("Deleted.", "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Delete failed", "err");
  }
}

async function pollScreens() {
  if (!el.screens) return;
  try {
    const res = await fetch("/api/screens");
    if (!res.ok) throw new Error("no discovery");
    const body = await res.json();
    const list = body.screens || [];
    el.screens.replaceChildren();
    el.screensEmpty.style.display = list.length ? "none" : "block";
    el.screensEmpty.textContent = list.length
      ? ""
      : "Waiting for beacons… Is the kiosk on Display role, same Wi‑Fi?";
    for (const s of list) {
      const busy = hostBusy(s.httpBase);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = busy
        ? `${s.displayName} — ${s.httpBase} (uploading ${formatBytes(busy.loaded)} / ${formatBytes(busy.total)})`
        : `${s.displayName} — ${s.httpBase} (${s.role})`;
      btn.addEventListener("click", () => {
        el.host.value = s.httpBase;
        connect();
      });
      el.screens.append(btn);
    }
  } catch {
    el.screensEmpty.style.display = "block";
    el.screensEmpty.textContent =
      "Auto-discovery needs npm run manager on this laptop. You can still type a host URL from the kiosk Settings screen.";
  }
}

function postFile(host, secret, file, onProgress, onXhr) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr(xhr);
    xhr.open("POST", `${host}${PREFIX}/content/files`);
    const headers = authHeaders(secret);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.timeout = 0;
    xhr.upload.onprogress = (ev) => {
      onProgress(ev.loaded, ev.lengthComputable ? ev.total : file.size);
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      reject(new Error(body.message || body.error || xhr.statusText || "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled"), { cancelled: true }));
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

async function startUpload() {
  const file = el.file.files?.[0];
  if (!file) {
    setStatus("Choose a file first.", "err");
    return;
  }
  const host = base();
  const secret = el.secret.value.trim();
  const displayName = session?.name || host;
  const limit = session?.maxUploadBytes || LIMIT;
  if (file.size > limit) {
    setStatus(`File is ${formatBytes(file.size)}; limit is ${formatBytes(limit)}.`, "err");
    return;
  }
  if (hostBusy(host)) {
    setStatus("This screen already has an upload in progress. Switch to another screen to start a second transfer.", "err");
    return;
  }

  const id = String(++transferSeq);
  const job = {
    id,
    host,
    displayName,
    fileName: file.name,
    loaded: 0,
    total: file.size,
    state: "uploading",
    error: "",
    xhr: null,
  };
  transfers.set(id, job);
  el.file.value = "";
  setStatus(`Queued ${file.name} → ${displayName}. You can switch screens.`);
  renderTransfers();

  try {
    const created = await postFile(
      host,
      secret,
      file,
      (loaded, total) => {
        job.loaded = loaded;
        job.total = total;
        scheduleTransferPaint();
      },
      (xhr) => {
        job.xhr = xhr;
      },
    );
    job.state = "applying";
    job.loaded = job.total;
    renderTransfers();
    const out = await apiAt(host, "PUT", "/content/current", {
      jsonBody: { type: "file", id: created.item.id },
      secret,
    });
    job.state = "done";
    renderTransfers();
    if (base() === host) {
      render(out.content);
      setStatus(`Uploaded and showing ${created.item.name} on ${displayName}.`, "ok");
    }
  } catch (err) {
    job.state = err && err.cancelled ? "cancelled" : "error";
    job.error = err instanceof Error ? err.message : "Upload failed";
    renderTransfers();
    if (base() === host && job.state === "error") {
      setStatus(job.error, "err");
    }
  }
}

el.connect.addEventListener("click", () => connect());
el.upload.addEventListener("click", () => startUpload());
el.showUrl.addEventListener("click", async () => {
  try {
    const url = el.url.value.trim();
    const out = await api("POST", "/content/urls", { jsonBody: { url, current: true } });
    render(out.content);
    setStatus("Showing URL.", "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "URL failed", "err");
  }
});
el.clearCurrent.addEventListener("click", async () => {
  try {
    const out = await api("PUT", "/content/current", { jsonBody: { type: "none" } });
    render(out.content);
    setStatus("Stopped showing.", "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Clear failed", "err");
  }
});

pollScreens();
setInterval(pollScreens, 2000);
