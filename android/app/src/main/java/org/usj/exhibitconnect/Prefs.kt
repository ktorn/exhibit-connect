package org.usj.exhibitconnect

import android.content.Context
import android.util.Base64
import java.security.MessageDigest
import java.util.UUID

class Prefs(context: Context) {
    private val p = context.getSharedPreferences("exhibit-connect", Context.MODE_PRIVATE)

    fun hasPin(): Boolean = p.contains("pin_hash")

    fun setPin(pin: String) {
        p.edit().putString("pin_hash", hash(pin)).apply()
    }

    fun checkPin(pin: String): Boolean = p.getString("pin_hash", null) == hash(pin)

    fun tabletId(): String {
        val existing = p.getString("tablet_id", null)
        if (existing != null) return existing
        val id = UUID.randomUUID().toString()
        p.edit().putString("tablet_id", id).apply()
        return id
    }

    var lastHttpBase: String?
        get() = p.getString("last_http_base", null)
        set(v) { p.edit().putString("last_http_base", v).apply() }

    var pairingBase: String?
        get() = p.getString("pairing_base", null)
        set(v) { p.edit().putString("pairing_base", v).apply() }

    var controllerUrl: String?
        get() = p.getString("controller_url", null)
        set(v) { p.edit().putString("controller_url", v).apply() }

    var exhibitId: String?
        get() = p.getString("exhibit_id", null)
        set(v) { p.edit().putString("exhibit_id", v).apply() }

    /** Forced orientation; never uses the accelerometer. */
    var orientation: String
        get() = p.getString("orientation", KioskPolicy.ORIENTATION_LANDSCAPE)
            ?: KioskPolicy.ORIENTATION_LANDSCAPE
        set(v) { p.edit().putString("orientation", v).apply() }

    fun unpair() {
        p.edit()
            .remove("last_http_base")
            .remove("pairing_base")
            .remove("controller_url")
            .remove("exhibit_id")
            .apply()
    }

    private fun hash(pin: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(("exhibit-connect|$pin").toByteArray())
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
