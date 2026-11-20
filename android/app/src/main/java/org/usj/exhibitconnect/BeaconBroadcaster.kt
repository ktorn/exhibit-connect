package org.usj.exhibitconnect

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/** UDP advertise for LAN content manager. Tablets ignore mode=content. */
class BeaconBroadcaster(
    private val port: Int = 41234,
    private val payload: () -> JSONObject?,
) {
    @Volatile
    private var running = false
    private var thread: Thread? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread {
            val socket = DatagramSocket()
            try {
                socket.broadcast = true
                val dest = InetAddress.getByName("255.255.255.255")
                while (running) {
                    try {
                        val obj = payload()
                        if (obj != null) {
                            val bytes = obj.toString().toByteArray(Charsets.UTF_8)
                            socket.send(DatagramPacket(bytes, bytes.size, dest, port))
                        }
                    } catch (_: Exception) {
                        /* no LAN yet */
                    }
                    try {
                        Thread.sleep(2000)
                    } catch (_: InterruptedException) {
                        break
                    }
                }
            } finally {
                socket.close()
            }
        }.also {
            it.isDaemon = true
            it.start()
        }
    }

    fun stop() {
        running = false
        thread?.interrupt()
        thread = null
    }
}
