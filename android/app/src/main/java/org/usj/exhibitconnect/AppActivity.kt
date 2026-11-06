package org.usj.exhibitconnect

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
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
    private val ping = object : Runnable {
        override fun run() {
            pingTablet()
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
        ui.removeCallbacks(ping)
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
        findViewById<View>(R.id.setupPanel).visibility = View.VISIBLE
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        findViewById<View>(R.id.web).visibility = View.GONE
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
        applyOrientation()
        enterKiosk()
    }

    private fun showSettings() {
        findViewById<View>(R.id.setupPanel).visibility = View.GONE
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
        findViewById<View>(R.id.web).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.VISIBLE
        checkOrientation(
            R.id.setOriLandscape,
            R.id.setOriLandscapeRev,
            R.id.setOriPortrait,
            R.id.setOriPortraitRev,
        )
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
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        applyOrientation()
        enterKiosk()
    }

    private fun enterKiosk() {
        findViewById<View>(R.id.setupPanel).visibility = View.GONE
        findViewById<View>(R.id.settingsPanel).visibility = View.GONE
        immersive()
        startLockTaskSafe()
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

    private fun startScan() {
        findViewById<View>(R.id.web).visibility = View.GONE
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun openController(url: String) {
        beacons.stop()
        findViewById<View>(R.id.pairingPanel).visibility = View.GONE
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
        ui.removeCallbacks(ping)
        ui.post(ping)
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
        AlertDialog.Builder(this)
            .setTitle("Staff")
            .setItems(
                arrayOf("Resume exhibit", "Settings", "Unpair tablet", "Exit app"),
            ) { _, which ->
                when (which) {
                    0 -> {
                        startLockTaskSafe()
                        immersive()
                    }
                    1 -> showSettings()
                    2 -> {
                        prefs.unpair()
                        findViewById<WebView>(R.id.web).loadUrl("about:blank")
                        startScan()
                        startLockTaskSafe()
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
