package org.usj.exhibitconnect

import android.os.Build
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.URI

data class Beacon(
    val exhibitId: String,
    val displayName: String,
    val student: String?,
    val httpPort: Int,
    val controllerPath: String,
    val lanHost: String,
    val mode: String,
    val httpBase: String,
    val pairingBase: String,
) {
    fun label(): String {
        val who = if (student.isNullOrBlank()) "" else " — $student"
        return "$displayName$who ($mode)"
    }
}

fun rewriteForEmulator(url: String): String {
    if (!isEmulator()) return url
    return url
        .replace("127.0.0.1", "10.0.2.2")
        .replace("localhost", "10.0.2.2")
}

fun isEmulator(): Boolean {
    val f = Build.FINGERPRINT.lowercase()
    val m = Build.MODEL.lowercase()
    return f.contains("generic") ||
        f.contains("emulator") ||
        m.contains("sdk") ||
        m.contains("emulator") ||
        Build.PRODUCT.contains("sdk")
}

fun parseBeacon(raw: String): Beacon? {
    return try {
        val o = JSONObject(raw)
        if (o.optInt("v") != 1) return null
        val httpBase = rewriteForEmulator(o.getString("httpBase").trimEnd('/'))
        val pairing = if (o.has("pairingBase")) {
            rewriteForEmulator(o.getString("pairingBase").trimEnd('/'))
        } else {
            httpBase
        }
        Beacon(
            exhibitId = o.getString("exhibitId"),
            displayName = o.getString("displayName"),
            student = o.optString("student").ifBlank { null },
            httpPort = o.getInt("httpPort"),
            controllerPath = o.optString("controllerPath", "/controller.html"),
            lanHost = URI(httpBase).host ?: o.getString("lanHost"),
            mode = o.getString("mode"),
            httpBase = httpBase,
            pairingBase = pairing,
        )
    } catch (_: Exception) {
        null
    }
}

class BeaconListener(
    private val port: Int = 41234,
    private val onBeacon: (Beacon) -> Unit,
) {
    @Volatile
    private var running = false
    private var thread: Thread? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread {
            val socket = DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress(port))
                soTimeout = 1500
            }
            val buf = ByteArray(2048)
            try {
                while (running) {
                    try {
                        val packet = DatagramPacket(buf, buf.size)
                        socket.receive(packet)
                        val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
                        parseBeacon(text)?.let { onBeacon(rewriteBeacon(it)) }
                    } catch (_: Exception) {
                        /* timeout / parse */
                    }
                }
            } finally {
                socket.close()
            }
        }.also { it.start() }
    }

    fun stop() {
        running = false
        thread?.interrupt()
        thread = null
    }
}

private fun rewriteBeacon(b: Beacon): Beacon {
    if (!isEmulator()) return b
    return b.copy(
        httpBase = rewriteForEmulator(b.httpBase),
        pairingBase = rewriteForEmulator(b.pairingBase),
        lanHost = if (b.lanHost == "127.0.0.1" || b.lanHost == "localhost") "10.0.2.2" else b.lanHost,
    )
}
