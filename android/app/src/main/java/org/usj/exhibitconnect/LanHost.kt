package org.usj.exhibitconnect

import java.net.Inet4Address
import java.net.NetworkInterface

object LanHost {
    fun listIpv4(): List<String> {
        val out = mutableListOf<String>()
        val nics = NetworkInterface.getNetworkInterfaces() ?: return out
        for (nic in nics) {
            if (!nic.isUp || nic.isLoopback) continue
            for (addr in nic.inetAddresses) {
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    val host = addr.hostAddress ?: continue
                    if (host.contains(':')) continue
                    out.add(host)
                }
            }
        }
        return out
    }

    fun pick(): String? {
        val all = listIpv4()
        return all.find { it.startsWith("10.") || it.startsWith("192.168.") } ?: all.firstOrNull()
    }
}
