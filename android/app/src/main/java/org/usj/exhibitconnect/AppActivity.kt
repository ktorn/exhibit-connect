package org.usj.exhibitconnect

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.Executors

class AppActivity : AppCompatActivity() {
    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()
    private lateinit var prefs: Prefs
    private var beacons = BeaconListener { beacon -> ui.post { onBeacon(beacon) } }
    private val seen = LinkedHashMap<String, Beacon>()
    private var pending: Beacon? = null
    private var tapCount = 0
    private var tapReset: Runnable? = null
    private var contentStore: ContentStore? = null
    private var contentServer: ContentHttpServer? = null
    private var contentBeacon: BeaconBroadcaster? = null
    private val ping = object : Runnable {
        override fun run() {
            pingTablet()
            ui.postDelayed(this, 15_000)
        }
    }
    private val refreshLan = object : Runnable {
        override fun run() {
            updateLanLabels()
            ui.postDelayed(this, 15_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        applyOrientation()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_app)
        findViewById<View>(R.id.exitHotspot).setOnClickListener { onExitTap() }
        findViewById<Button>(R.id.savePin).setOnClickListener { savePin() }
        findViewById<Button>(R.id.confirm).setOnClickListener { confirmPair() }
        findViewById<Button>(R.id.saveSettings).setOnClickListener { saveSettings() }
        findViewById<RadioGroup>(R.id.settingsRole).setOnCheckedChangeListener { _, _ ->
            findViewById<View>(R.id.displaySettings).visibility =
                if (roleFrom(R.id.settingsRole) == Prefs.ROLE_DISPLAY) View.VISIBLE else View.GONE
        }
        if (!prefs.hasPin()) {
            showSetup()
        } else {
            enterKiosk()
        }
    }

    override fun onResume() {
        super.onResume()
        KioskPolicy.apply(this)
        immersive()
        if (prefs.hasPin() && findViewById<View>(R.id.settingsPanel).visibility != View.VISIBLE) {
            startLockTaskSafe()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        beacons.stop()
        stopDisplayServer()
        ui.removeCallbacks(ping)
        ui.removeCallbacks(refreshLan)
        io.shutdownNow()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        /* kiosk: ignore */
    }

    private fun applyOrientation() {
        requestedOrientation = KioskPolicy.activityInfo(prefs.orientation)
    }

    private fun orientationFrom(groupId: Int): String {
        val id = findViewById<RadioGroup>(groupId).checkedRadioButtonId
        return when (id) {
            R.id.oriPortrait, R.id.setOriPortrait -> KioskPolicy.ORIENTATION_PORTRAIT
            R.id.oriPortraitRev, R.id.setOriPortraitRev -> KioskPolicy.ORIENTATION_PORTRAIT_REV
            R.id.oriLandscapeRev, R.id.setOriLandscapeRev -> KioskPolicy.ORIENTATION_LANDSCAPE_REV
            else -> KioskPolicy.ORIENTATION_LANDSCAPE
        }
    }

    private fun roleFrom(groupId: Int): String {
        val id = findViewById<RadioGroup>(groupId).checkedRadioButtonId
        return when (id) {
            R.id.roleDisplay, R.id.setRoleDisplay -> Prefs.ROLE_DISPLAY
            else -> Prefs.ROLE_TABLET
        }
    }

    private fun checkOrientation(landscape: Int, landscapeRev: Int, portrait: Int, portraitRev: Int) {
        val id = when (prefs.orientation) {
            KioskPolicy.ORIENTATION_PORTRAIT -> portrait
            KioskPolicy.ORIENTATION_PORTRAIT_REV -> portraitRev
            KioskPolicy.ORIENTATION_LANDSCAPE_REV -> landscapeRev
            else -> landscape
        }
        findViewById<RadioGroup>(R.id.settingsOrientation).check(id)
    }

    private fun showSetup() {
        stopPlayback()
        findViewById<View>(R.id.setupPanel).visibility = View.VISIBLE
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        findViewById<View>(R.id.web).visibility = View.GONE
        findViewById<View>(R.id.video).visibility = View.GONE
        findViewById<View>(R.id.idlePanel).visibility = View.GONE
    }

    private fun savePin() {
        val a = findViewById<EditText>(R.id.pin1).text.toString()
        val b = findViewById<EditText>(R.id.pin2).text.toString()
        val status = findViewById<TextView>(R.id.setupStatus)
        if (a.length !in 4..8 || !a.all { it.isDigit() }) {
            status.text = "Use 4–8 digits."
            return
        }
        if (a != b) {
            status.text = "PINs do not match."
            return
        }
        prefs.setPin(a)
        prefs.orientation = orientationFrom(R.id.setupOrientation)
        prefs.role = roleFrom(R.id.setupRole)
        applyOrientation()
        enterKiosk()
    }

    private fun showSettings() {
        stopPlayback()
        beacons.stop()
        ui.removeCallbacks(ping)
        findViewById<View>(R.id.setupPanel).visibility = View.GONE
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        findViewById<View>(R.id.web).visibility = View.GONE
        findViewById<View>(R.id.video).visibility = View.GONE
        findViewById<View>(R.id.idlePanel).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.VISIBLE
        checkOrientation(
            R.id.setOriLandscape,
            R.id.setOriLandscapeRev,
            R.id.setOriPortrait,
            R.id.setOriPortraitRev,
        )
        findViewById<RadioGroup>(R.id.settingsRole).check(
            if (prefs.isDisplay()) R.id.setRoleDisplay else R.id.setRoleTablet,
        )
        findViewById<View>(R.id.displaySettings).visibility =
            if (prefs.isDisplay()) View.VISIBLE else View.GONE
        updateLanLabels()
        val current = contentStore?.snapshot()?.optJSONObject("current")
        findViewById<EditText>(R.id.displayName).setText(prefs.displayName)
        if (current?.optString("type") == "url") {
            findViewById<EditText>(R.id.displayUrl).setText(current.optString("url"))
        }
        val owner = if (KioskPolicy.isDeviceOwner(this)) {
            "Status bar / notification shade: blocked (device owner)."
        } else {
            "Status bar swipe is fully blocked only after device owner:\n" +
                "adb shell dpm set-device-owner org.usj.exhibitconnect/.AdminReceiver"
        }
        findViewById<TextView>(R.id.ownerStatus).text = owner
    }

    private fun saveSettings() {
        prefs.orientation = orientationFrom(R.id.settingsOrientation)
        val newRole = roleFrom(R.id.settingsRole)
        val roleChanged = newRole != prefs.role
        prefs.role = newRole
        val name = findViewById<EditText>(R.id.displayName).text.toString().trim()
        if (name.isNotEmpty()) prefs.displayName = name
        val url = findViewById<EditText>(R.id.displayUrl).text.toString().trim()
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        applyOrientation()
        if (newRole == Prefs.ROLE_DISPLAY) {
            if (roleChanged) {
                prefs.unpair()
                beacons.stop()
            }
            ensureDisplayServer()
            if (url.isNotEmpty()) {
                try {
                    contentStore?.setCurrent(JSONObject().put("type", "url").put("url", url))
                } catch (_: Exception) {
                    /* invalid URL kept off-screen */
                }
            }
        } else if (roleChanged) {
            stopDisplayServer()
        }
        enterKiosk()
    }

    private fun enterKiosk() {
        findViewById<View>(R.id.setupPanel).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        immersive()
        startLockTaskSafe()
        if (prefs.isDisplay()) {
            enterDisplayKiosk()
        } else {
            stopDisplayServer()
            findViewById<View>(R.id.idlePanel).visibility = View.GONE
            findViewById<View>(R.id.video).visibility = View.GONE
            enterTabletKiosk()
        }
    }

    private fun enterTabletKiosk() {
        val last = prefs.lastHttpBase
        val controller = prefs.controllerUrl
        if (!last.isNullOrBlank() && !controller.isNullOrBlank()) {
            setStatus("Trying last IP $last…")
            io.execute {
                try {
                    val st = ConnectApi.status(last)
                    val ok = st.optBoolean("paired") &&
                        st.optString("pairedTabletId") == prefs.tabletId()
                    ui.post {
                        if (ok) openController(controller) else startScan()
                    }
                } catch (_: Exception) {
                    ui.post { startScan() }
                }
            }
        } else {
            startScan()
        }
    }

    private fun enterDisplayKiosk() {
        beacons.stop()
        ui.removeCallbacks(ping)
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        ensureDisplayServer()
        ui.removeCallbacks(refreshLan)
        ui.post(refreshLan)
        applyDisplayContent()
    }

    private fun ensureDisplayServer() {
        if (contentStore == null) {
            contentStore = ContentStore(this)
        }
        contentStore?.listener = { ui.post { applyDisplayContent() } }
        if (contentServer == null) {
            val server = ContentHttpServer(
                store = contentStore!!,
                assets = assets,
                checkPin = { prefs.checkPin(it) },
                exhibitId = prefs.exhibitId ?: "display-${prefs.tabletId().take(8)}",
                displayName = prefs.displayName,
                preferredPort = prefs.contentPort,
            )
            try {
                server.start()
                prefs.contentPort = server.port
                if (prefs.exhibitId.isNullOrBlank()) {
                    prefs.exhibitId = "display-${prefs.tabletId().take(8)}"
                }
                contentServer = server
            } catch (e: Exception) {
                findViewById<TextView>(R.id.idleMessage).text =
                    "Content API failed to bind (${e.message})"
            }
        }
        if (contentServer != null && contentBeacon == null) {
            startContentBeacon()
        }
    }

    private fun startContentBeacon() {
        contentBeacon?.stop()
        contentBeacon = BeaconBroadcaster {
            val host = LanHost.pick() ?: return@BeaconBroadcaster null
            val port = contentServer?.port ?: prefs.contentPort
            val id = prefs.exhibitId ?: "display-${prefs.tabletId().take(8)}"
            JSONObject()
                .put("v", 1)
                .put("exhibitId", id)
                .put("displayName", prefs.displayName)
                .put("httpPort", port)
                .put("lanHost", host)
                .put("mode", "content")
                .put("role", "display")
                .put("httpBase", "http://$host:$port")
                .put("capabilities", org.json.JSONArray().put("content"))
        }
        contentBeacon?.start()
    }

    private fun stopDisplayServer() {
        contentBeacon?.stop()
        contentBeacon = null
        contentServer?.stop()
        contentServer = null
        contentStore?.listener = null
        ui.removeCallbacks(refreshLan)
    }

    private fun applyDisplayContent() {
        if (!prefs.isDisplay()) return
        if (findViewById<View>(R.id.settingsPanel).visibility == View.VISIBLE) return
        val store = contentStore ?: return
        val state = store.snapshot()
        val current = state.optJSONObject("current")
        if (current == null) {
            stopPlayback()
            findViewById<View>(R.id.web).visibility = View.GONE
            findViewById<View>(R.id.video).visibility = View.GONE
            findViewById<View>(R.id.idlePanel).visibility = View.VISIBLE
            updateLanLabels()
            return
        }
        findViewById<View>(R.id.idlePanel).visibility = View.GONE
        val type = current.optString("type")
        if (type == "file") {
            val id = current.optString("id")
            val item = store.find(state, id)
            val port = contentServer?.port ?: prefs.contentPort
            val url = ContentHttpServer.localFileUrl(port, id)
            if (ContentStore.isVideo(item?.optString("mime"))) {
                playVideo(url)
            } else {
                openWeb(url, ping = false)
            }
        } else {
            val url = current.optString("url")
            if (url.isBlank()) {
                findViewById<View>(R.id.idlePanel).visibility = View.VISIBLE
                return
            }
            openWeb(url, ping = false)
        }
    }

    private fun playVideo(url: String) {
        findViewById<WebView>(R.id.web).apply {
            loadUrl("about:blank")
            visibility = View.GONE
        }
        val video = findViewById<VideoView>(R.id.video)
        video.visibility = View.VISIBLE
        video.setOnPreparedListener { mp ->
            mp.isLooping = true
            mp.start()
        }
        video.setVideoURI(Uri.parse(url))
        video.start()
        immersive()
    }

    private fun stopPlayback() {
        try {
            findViewById<VideoView>(R.id.video).stopPlayback()
        } catch (_: Exception) {
        }
        findViewById<View>(R.id.video).visibility = View.GONE
    }

    private fun managerUrls(): String {
        val port = contentServer?.port ?: prefs.contentPort
        val hosts = LanHost.listIpv4()
        if (hosts.isEmpty()) return "Waiting for LAN… port $port"
        return hosts.joinToString("\n") { "http://$it:$port/" }
    }

    private fun updateLanLabels() {
        val text = managerUrls()
        findViewById<TextView>(R.id.idleApiUrl).text = text
        findViewById<TextView>(R.id.settingsApiUrl).text = "Manager / content API:\n$text"
    }

    private fun startScan() {
        stopPlayback()
        findViewById<View>(R.id.web).visibility = View.GONE
        findViewById<View>(R.id.idlePanel).visibility = View.GONE
        findViewById<View>(R.id.pairingPanel).visibility = View.VISIBLE
        setStatus("Listening for exhibit PCs…")
        beacons.start()
        if (isEmulator()) {
            io.execute { probeHost("http://10.0.2.2:8899") }
        }
    }

    private fun probeHost(base: String) {
        try {
            val st = ConnectApi.status(base)
            val beacon = Beacon(
                exhibitId = st.getString("exhibitId"),
                displayName = st.optString("displayName", st.getString("exhibitId")),
                student = null,
                httpPort = 8899,
                controllerPath = st.optString("controllerPath", "/controller.html"),
                lanHost = "10.0.2.2",
                mode = if (st.optBoolean("discoveryEnabled")) "discovery" else "reconnect",
                httpBase = rewriteForEmulator(st.optString("httpBase", base)),
                pairingBase = rewriteForEmulator(st.optString("httpBase", base)),
            )
            ui.post { onBeacon(beacon) }
        } catch (_: Exception) {
            /* host exhibit not running */
        }
    }

    private fun onBeacon(beacon: Beacon) {
        if (beacon.mode != "discovery" && beacon.mode != "reconnect") {
            return
        }
        val ours = prefs.exhibitId
        if (ours != null && beacon.exhibitId != ours && beacon.mode != "discovery") {
            return
        }
        seen[beacon.exhibitId] = beacon
        renderList()
        if (ours != null && beacon.exhibitId == ours && prefs.tabletId().isNotEmpty()) {
            tryReconnect(beacon)
        }
    }

    private fun renderList() {
        val list = findViewById<LinearLayout>(R.id.pcList)
        list.removeAllViews()
        for (b in seen.values) {
            val btn = Button(this).apply {
                text = b.label()
                isEnabled = b.mode == "discovery" ||
                    (prefs.exhibitId == b.exhibitId)
                setOnClickListener { selectPc(b) }
            }
            list.addView(btn)
        }
        if (seen.isNotEmpty()) {
            setStatus("Select the exhibit PC.")
        }
    }

    private fun selectPc(b: Beacon) {
        if (prefs.exhibitId == b.exhibitId && !prefs.controllerUrl.isNullOrBlank()) {
            tryReconnect(b)
            return
        }
        if (b.mode != "discovery") {
            setStatus("PC is paired to another tablet.")
            return
        }
        pending = b
        io.execute {
            val (code, body) = ConnectApi.post(
                b.pairingBase,
                "/pair/start",
                JSONObject().put("tabletId", prefs.tabletId()),
            )
            ui.post {
                if (code != 200) {
                    setStatus(body.optString("message", "Cannot start pairing"))
                } else {
                    findViewById<View>(R.id.codeRow).visibility = View.VISIBLE
                    setStatus("Enter the code shown on the main projection.")
                }
            }
        }
    }

    private fun confirmPair() {
        val b = pending ?: return
        val code = findViewById<EditText>(R.id.code).text.toString().trim()
        io.execute {
            val (status, body) = ConnectApi.post(
                b.pairingBase,
                "/pair/confirm",
                JSONObject()
                    .put("tabletId", prefs.tabletId())
                    .put("code", code),
            )
            ui.post {
                if (status != 200) {
                    setStatus(body.optString("message", "Wrong code"))
                    return@post
                }
                val httpBase = rewriteForEmulator(body.getString("httpBase"))
                val controller = rewriteForEmulator(body.getString("controllerUrl"))
                prefs.lastHttpBase = httpBase
                prefs.pairingBase = b.pairingBase
                prefs.controllerUrl = controller
                prefs.exhibitId = body.optString("exhibitId", b.exhibitId)
                openController(controller)
            }
        }
    }

    private fun tryReconnect(b: Beacon) {
        io.execute {
            try {
                val st = ConnectApi.status(b.pairingBase)
                if (st.optString("pairedTabletId") != prefs.tabletId()) {
                    ui.post { setStatus("PC is paired to another tablet.") }
                    return@execute
                }
                ConnectApi.post(
                    b.pairingBase,
                    "/tablet/ping",
                    JSONObject().put("tabletId", prefs.tabletId()),
                )
                val url = prefs.controllerUrl
                    ?: rewriteForEmulator(b.httpBase + b.controllerPath)
                ui.post { openController(url) }
            } catch (_: Exception) {
                ui.post { setStatus("Found beacon but HTTP failed.") }
            }
        }
    }

    private fun openController(url: String) {
        openWeb(url, ping = true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openWeb(url: String, ping: Boolean) {
        beacons.stop()
        stopPlayback()
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        findViewById<View>(R.id.idlePanel).visibility = View.GONE
        val web = findViewById<WebView>(R.id.web)
        web.visibility = View.VISIBLE
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        web.settings.allowFileAccess = false
        web.loadUrl(url)
        ui.removeCallbacks(this.ping)
        if (ping) ui.post(this.ping)
        immersive()
    }

    private fun pingTablet() {
        val base = prefs.pairingBase ?: prefs.lastHttpBase ?: return
        io.execute {
            try {
                ConnectApi.post(
                    base,
                    "/tablet/ping",
                    JSONObject().put("tabletId", prefs.tabletId()),
                )
            } catch (_: Exception) {
                /* will reconnect via beacon when idle */
            }
        }
    }

    private fun onExitTap() {
        tapCount += 1
        tapReset?.let { ui.removeCallbacks(it) }
        val reset = Runnable { tapCount = 0 }
        tapReset = reset
        ui.postDelayed(reset, 850)
        if (tapCount >= 5) {
            tapCount = 0
            askPinToExit()
        }
    }

    private fun askPinToExit() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Staff PIN"
        }
        AlertDialog.Builder(this)
            .setTitle("Leave kiosk")
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                if (prefs.checkPin(input.text.toString())) {
                    staffMenu()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
        input.post {
            input.requestFocus()
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun staffMenu() {
        val items = if (prefs.isDisplay()) {
            arrayOf("Resume exhibit", "Settings", "Clear content", "Exit app")
        } else {
            arrayOf("Resume exhibit", "Settings", "Unpair tablet", "Exit app")
        }
        AlertDialog.Builder(this)
            .setTitle("Staff")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> {
                        startLockTaskSafe()
                        immersive()
                        if (prefs.isDisplay()) applyDisplayContent()
                    }
                    1 -> showSettings()
                    2 -> {
                        if (prefs.isDisplay()) {
                            contentStore?.clear()
                            startLockTaskSafe()
                            applyDisplayContent()
                        } else {
                            prefs.unpair()
                            findViewById<WebView>(R.id.web).loadUrl("about:blank")
                            startScan()
                            startLockTaskSafe()
                        }
                    }
                    3 -> {
                        try {
                            stopLockTask()
                        } catch (_: Exception) {
                        }
                        finishAffinity()
                    }
                }
            }
            .setCancelable(false)
            .show()
    }

    private fun startLockTaskSafe() {
        try {
            startLockTask()
        } catch (_: Exception) {
            /* not device-owner yet; still fullscreen */
        }
    }

    private fun immersive() {
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
        )
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.hide(
                android.view.WindowInsets.Type.statusBars() or
                    android.view.WindowInsets.Type.navigationBars(),
            )
            // Do not use SHOW_TRANSIENT_BARS_BY_SWIPE — that is the shade pull-down.
            if (Build.VERSION.SDK_INT >= 31) {
                window.insetsController?.systemBarsBehavior = 0
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        }
    }

    private fun setStatus(text: String) {
        findViewById<TextView>(R.id.status).text = text
    }
}
