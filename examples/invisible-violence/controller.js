const INITIAL_STATUS_TEXT =
  "Use Attack More or Attack Less to change what appears on the main screen.";

const clickBtn = document.getElementById("click-btn");
const minusBtn = document.getElementById("long-press-btn");
const statusText = document.getElementById("status-text");
const relayHint = document.getElementById("relay-hint");
const bgVideo = document.getElementById("bg-video");
const fsZone = document.getElementById("controller-fs-zone");
const fsFeedbackEl = document.getElementById("controller-fs-feedback");

const FS_FEEDBACK_VISIBLE_MS = 2600;
/** Session dismissal for Home Screen kiosk explainer banner. */
const KIOSK_BANNER_DISMISS_KEY = "iv-controller-kiosk-hint-dismissed";

/** Window for counting taps toward fullscreen (ms). */
const CONTROLLER_FS_TAP_WINDOW_MS = 850;
const CONTROLLER_FS_TAPS_REQUIRED = 5;

let fsTapCount = 0;
let fsTapResetTimer = null;

const VIDEO_MISSING_HINT =
  "No background video: copy your file to assets/ipad-background.mov or .mp4 (see assets/README.txt).";

const RELAY_EXPECTED = "invisible-violence-relay";

let ws;
let reconnectTimer = null;
let relayChecked = false;

function setRelayHintVisible(show, html) {
  if (!relayHint) {
    return;
  }
  relayHint.style.display = show ? "block" : "none";
  if (html !== undefined) {
    relayHint.innerHTML = html;
  }
}

function showWrongServerHint() {
  if (!relayHint) {
    return;
  }
  relayHint.style.display = "block";
  relayHint.innerHTML =
    "This page needs the <strong>Node</strong> relay. In the project folder run " +
    '<code style="background:#222;padding:2px 6px;border-radius:4px">npm install</code> then ' +
    '<code style="background:#222;padding:2px 6px;border-radius:4px">npm start</code> ' +
    "and open this URL at <strong>http://&lt;PC-IP&gt;:8899/controller.html</strong> " +
    "(not <code>python -m http.server</code> — it has no WebSocket).";
}

function setStatus(text) {
  statusText.textContent = text;
}

function sendLanguageStep(step) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("Not connected — wait for relay or tap again.");
    return;
  }
  ws.send(JSON.stringify({ type: "lang_step", step }));
  setStatus(
    step > 0
      ? "Attack More sent — check the main screen."
      : "Attack Less sent — check the main screen."
  );
}

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const params = new URLSearchParams(location.search);
  const wsOverride = params.get("ws");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = wsOverride || proto + "//" + location.host + "/ws";
  try {
    ws = new WebSocket(wsUrl);
  } catch (_e) {
    reconnectTimer = setTimeout(connect, 2000);
    return;
  }
  ws.onopen = () => {
    setRelayHintVisible(false);
    setStatus("Connected — same WiFi as display PC");
  };
  ws.onclose = () => {
    setStatus("Disconnected — retrying…");
    if (relayChecked) {
      reconnectTimer = setTimeout(connect, 2000);
    }
  };
  ws.onerror = () => {
    setStatus("WebSocket error — is npm start running?");
  };
  ws.onmessage = () => {
    /* Ignore broadcasts (e.g. lang_step echoed to all clients). */
  };
}

function checkRelayThenConnect() {
  fetch(location.origin + "/__relay_ok", { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => {
      relayChecked = true;
      if (text.trim() !== RELAY_EXPECTED) {
        setStatus("Wrong server — see note below");
        showWrongServerHint();
        return;
      }
      connect();
    })
    .catch(() => {
      relayChecked = true;
      setStatus("Cannot reach relay PC");
      showWrongServerHint();
    });
}

let fsFeedbackHideTimer = null;

/** Same tap fires pointerdown then click on some Android browsers — count once. */
let fsSuppressClickUntilMs = 0;

function showFsFeedback(message) {
  if (!fsFeedbackEl || !message) {
    return;
  }
  fsFeedbackEl.textContent = message;
  fsFeedbackEl.classList.add("is-visible");
  if (fsFeedbackHideTimer !== null) {
    clearTimeout(fsFeedbackHideTimer);
  }
  fsFeedbackHideTimer = window.setTimeout(() => {
    fsFeedbackHideTimer = null;
    fsFeedbackEl.classList.remove("is-visible");
    fsFeedbackEl.textContent = "";
  }, FS_FEEDBACK_VISIBLE_MS);
}

function noteFullscreenTapFromPointer() {
  fsSuppressClickUntilMs = Date.now() + 480;
  noteFullscreenTap();
}

function noteFullscreenTapFromClick() {
  if (Date.now() < fsSuppressClickUntilMs) {
    return;
  }
  noteFullscreenTap();
}

/** True when opened from Add to Home Screen (no Safari/Chrome browser chrome). */
function isStandaloneDisplayMode() {
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
    if (window.matchMedia("(display-mode: fullscreen)").matches) {
      return true;
    }
  }
  return window.navigator.standalone === true;
}

function wireKioskStandaloneBanner() {
  const banner = document.getElementById("controller-kiosk-banner");
  const dismissBtn = document.getElementById("controller-kiosk-banner-dismiss");
  if (!banner || !dismissBtn) {
    return;
  }
  if (
    sessionStorage.getItem(KIOSK_BANNER_DISMISS_KEY) === "1" ||
    isStandaloneDisplayMode()
  ) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  dismissBtn.addEventListener("click", () => {
    banner.hidden = true;
    sessionStorage.setItem(KIOSK_BANNER_DISMISS_KEY, "1");
  });
}

clickBtn.addEventListener("click", () => sendLanguageStep(1));
minusBtn.addEventListener("click", () => sendLanguageStep(-1));

function resetFullscreenTapSequence() {
  fsTapCount = 0;
  if (fsTapResetTimer !== null) {
    clearTimeout(fsTapResetTimer);
    fsTapResetTimer = null;
  }
}

function controllerFullscreenNative() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
}

/** True if native fullscreen OR CSS fallback (iPad WebKit often no-ops requestFullscreen). */
function controllerFullscreenEffective() {
  return (
    controllerFullscreenNative() ||
    document.body.classList.contains("controller-faux-fullscreen")
  );
}

function enableFauxFullscreen() {
  document.body.classList.add("controller-faux-fullscreen");
}

function disableFauxFullscreen() {
  document.body.classList.remove("controller-faux-fullscreen");
}

function syncFauxWithNativeFullscreen() {
  if (controllerFullscreenNative()) {
    disableFauxFullscreen();
  }
}

document.addEventListener("fullscreenchange", syncFauxWithNativeFullscreen);
document.addEventListener(
  "webkitfullscreenchange",
  syncFauxWithNativeFullscreen
);

function exitAllFullscreenModes() {
  disableFauxFullscreen();
  if (!controllerFullscreenNative()) {
    return;
  }
  const doc = document;
  const exit =
    doc.exitFullscreen ||
    doc.webkitExitFullscreen ||
    doc.msExitFullscreen;
  if (exit) {
    exit.call(doc).catch(() => {});
  }
}

function tryRequestFullscreenOn(node) {
  const req =
    node.requestFullscreen ||
    node.webkitRequestFullscreen ||
    node.msRequestFullscreen;
  if (!req) {
    return Promise.reject(new Error("no fullscreen"));
  }
  return req.call(node);
}

/**
 * Runs from the last tap’s user gesture. Chrome Android usually gets real fullscreen on <html>;
 * iPad WebKit often does not — faux / Home Screen paths handled after verify.
 */
function enterControllerFullscreenBestEffort() {
  const root = document.documentElement;
  const body = document.body;

  const verifyNativeOrFaux = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (controllerFullscreenNative()) {
            disableFauxFullscreen();
            resolve("native");
            return;
          }
          if (isStandaloneDisplayMode()) {
            disableFauxFullscreen();
            resolve("standalone-app");
            return;
          }
          enableFauxFullscreen();
          resolve("faux");
        });
      });
    });

  return tryRequestFullscreenOn(root)
    .catch(() => tryRequestFullscreenOn(body))
    .then(verifyNativeOrFaux)
    .catch(() => {
      if (isStandaloneDisplayMode()) {
        return "standalone-app";
      }
      enableFauxFullscreen();
      return "faux";
    });
}

function noteFullscreenTap() {
  fsTapCount += 1;
  if (fsTapResetTimer !== null) {
    clearTimeout(fsTapResetTimer);
  }
  fsTapResetTimer = window.setTimeout(() => {
    fsTapResetTimer = null;
    fsTapCount = 0;
  }, CONTROLLER_FS_TAP_WINDOW_MS);

  if (fsTapCount >= CONTROLLER_FS_TAPS_REQUIRED) {
    const willExitFullscreen = controllerFullscreenEffective();
    resetFullscreenTapSequence();
    if (willExitFullscreen) {
      exitAllFullscreenModes();
      showFsFeedback("Leaving fullscreen…");
      return;
    }
    enterControllerFullscreenBestEffort().then((mode) => {
      if (mode === "native") {
        showFsFeedback("Fullscreen on.");
        return;
      }
      if (mode === "standalone-app") {
        showFsFeedback(
          "Opened from Home Screen — browser bars are already hidden."
        );
        return;
      }
      showFsFeedback(
        "Safari/Chrome cannot hide the URL bar inside a tab. Share → Add to Home Screen → open from that icon."
      );
    });
    return;
  }

  if (fsTapCount >= 3) {
    const remaining = CONTROLLER_FS_TAPS_REQUIRED - fsTapCount;
    const exiting = controllerFullscreenEffective();
    const goal = exiting ? "to exit fullscreen" : "for fullscreen";
    showFsFeedback(
      remaining === 1
        ? `Tap 1 more time ${goal}.`
        : `Tap ${remaining} more times ${goal}.`
    );
  }
}

if (fsZone) {
  fsZone.addEventListener("pointerdown", noteFullscreenTapFromPointer, {
    passive: true,
  });
  fsZone.addEventListener("click", noteFullscreenTapFromClick);
}

checkRelayThenConnect();

let bgVideoGestureUnlockInstalled = false;

function tryPlayBackgroundVideo() {
  if (!bgVideo) {
    return;
  }
  bgVideo.muted = true;
  bgVideo.defaultMuted = true;
  bgVideo.setAttribute("muted", "");
  bgVideo.playsInline = true;
  const playAttempt = bgVideo.play();
  if (playAttempt && typeof playAttempt.catch === "function") {
    playAttempt.catch(() => {
      if (bgVideoGestureUnlockInstalled) {
        return;
      }
      bgVideoGestureUnlockInstalled = true;
      statusText.textContent =
        "Tap anywhere once if the background stays black (tablet autoplay).";
      const unlock = () => {
        bgVideoGestureUnlockInstalled = false;
        bgVideo.play().catch(() => {});
        statusText.textContent = INITIAL_STATUS_TEXT;
      };
      document.documentElement.addEventListener("pointerdown", unlock, {
        capture: true,
        once: true,
      });
      document.documentElement.addEventListener(
        "touchend",
        unlock,
        { capture: true, once: true }
      );
    });
  }
}

function wireControllerBackgroundVideo() {
  if (!bgVideo) {
    return;
  }
  /* iPad/WebKit (incl. “Chrome” on iOS): inline + muted must be explicit for autoplay. */
  bgVideo.setAttribute("playsinline", "");
  bgVideo.setAttribute("webkit-playsinline", "true");
  bgVideo.playsInline = true;

  const kick = () => {
    tryPlayBackgroundVideo();
  };
  bgVideo.addEventListener("loadeddata", kick);
  bgVideo.addEventListener("canplay", kick);
  bgVideo.addEventListener("stalled", kick);
  bgVideo.addEventListener("waiting", kick);
  bgVideo.addEventListener("playing", () => {
    bgVideoGestureUnlockInstalled = false;
  });
  bgVideo.addEventListener("error", () => {
    statusText.textContent = VIDEO_MISSING_HINT;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      kick();
    }
  });
  kick();
}

wireControllerBackgroundVideo();

wireKioskStandaloneBanner();
