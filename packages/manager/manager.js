const PREFIX = "/__exhibit-connect/v1";

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
};

if (!el.host.value) {
  el.host.value = window.location.origin;
}

function base() {
  return String(el.host.value || "").replace(/\/$/, "");
}

function authHeaders(extra = {}) {
  const secret = el.secret.value.trim();
  const headers = { ...extra };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers["X-Exhibit-Pin"] = secret;
    headers["X-Exhibit-Admin-Token"] = secret;
  }
  return headers;
}

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.className = kind || "";
}

async function api(method, path, { jsonBody, form } = {}) {
  const headers = authHeaders(jsonBody ? { "Content-Type": "application/json" } : {});
  const res = await fetch(`${base()}${PREFIX}${path}`, {
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
    const msg = body.message || body.error || res.statusText;
    throw new Error(msg);
  }
  return body;
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
  render(content);
  return content;
}

async function connect() {
  try {
    const status = await api("GET", "/status");
    const auth = status.auth?.mutate || "none";
    const who = status.displayName || status.exhibitId || "host";
    setStatus(
      `Connected to ${who} (${status.role || "host"}; auth ${auth}).`,
      "ok",
    );
    el.panel.style.display = "block";
    await refresh();
  } catch (err) {
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

el.connect.addEventListener("click", () => connect());

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

el.upload.addEventListener("click", async () => {
  const file = el.file.files?.[0];
  if (!file) {
    setStatus("Choose a file first.", "err");
    return;
  }
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const created = await api("POST", "/content/files", { form });
    const out = await api("PUT", "/content/current", {
      jsonBody: { type: "file", id: created.item.id },
    });
    render(out.content);
    el.file.value = "";
    setStatus("Uploaded and showing " + created.item.name, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Upload failed", "err");
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
