package org.usj.exhibitconnect

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

class ContentStore(context: Context) {
    val filesDir = File(context.filesDir, "content/files").apply { mkdirs() }
    private val metaFile = File(context.filesDir, "content/meta.json")
    private val lock = Any()
    var listener: (() -> Unit)? = null

    fun filePath(id: String) = File(filesDir, id)

    fun snapshot(): JSONObject = synchronized(lock) {
        loadLocked()
    }

    fun addFile(id: String, name: String, mime: String, size: Long): JSONObject = synchronized(lock) {
        val state = loadLocked()
        val item = JSONObject()
            .put("id", id)
            .put("type", "file")
            .put("name", sanitizeName(name))
            .put("mime", mime)
            .put("size", size)
            .put("createdAt", nowIso())
        state.getJSONArray("items").put(item)
        saveLocked(state)
        notifyChanged()
        item
    }

    fun addUrl(url: String, name: String?): JSONObject = synchronized(lock) {
        if (!isAllowedUrl(url)) throw IllegalArgumentException("invalid_url")
        val state = loadLocked()
        val items = state.getJSONArray("items")
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            if (it.optString("type") == "url" && it.optString("url") == url) return it
        }
        val item = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("type", "url")
            .put("name", name?.trim().takeUnless { it.isNullOrEmpty() } ?: url)
            .put("url", url)
            .put("createdAt", nowIso())
        items.put(item)
        saveLocked(state)
        notifyChanged()
        item
    }

    fun setCurrent(spec: JSONObject): JSONObject = synchronized(lock) {
        val state = loadLocked()
        val type = spec.optString("type")
        if (type.isEmpty() || type == "none" || spec.isNull("type")) {
            state.put("current", JSONObject.NULL)
            saveLocked(state)
            notifyChanged()
            return state
        }
        if (type == "url") {
            val url = spec.optString("url").trim()
            val item = addUrlLocked(state, url, spec.optString("name").ifBlank { null })
            state.put(
                "current",
                JSONObject().put("type", "url").put("id", item.getString("id")).put("url", url),
            )
            saveLocked(state)
            notifyChanged()
            return state
        }
        if (type == "file") {
            val id = spec.optString("id")
            val item = find(state, id) ?: throw IllegalArgumentException("not_found")
            if (item.optString("type") != "file") throw IllegalArgumentException("not_found")
            state.put("current", JSONObject().put("type", "file").put("id", id))
            saveLocked(state)
            notifyChanged()
            return state
        }
        throw IllegalArgumentException("invalid_body")
    }

    fun remove(id: String): JSONObject = synchronized(lock) {
        val state = loadLocked()
        val items = state.getJSONArray("items")
        val next = JSONArray()
        var removed: JSONObject? = null
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            if (it.getString("id") == id) removed = it else next.put(it)
        }
        if (removed == null) throw IllegalArgumentException("not_found")
        state.put("items", next)
        val current = state.optJSONObject("current")
        if (current != null && (current.optString("id") == id || current.optString("url") == removed.optString("url"))) {
            state.put("current", JSONObject.NULL)
        }
        saveLocked(state)
        if (removed.optString("type") == "file") {
            filePath(id).delete()
        }
        notifyChanged()
        state
    }

    fun clear() = synchronized(lock) {
        filesDir.listFiles()?.forEach { it.delete() }
        saveLocked(JSONObject().put("items", JSONArray()).put("current", JSONObject.NULL))
        notifyChanged()
    }

    fun find(state: JSONObject, id: String): JSONObject? {
        val items = state.optJSONArray("items") ?: return null
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            if (it.getString("id") == id) return it
        }
        return null
    }

    private fun addUrlLocked(state: JSONObject, url: String, name: String?): JSONObject {
        if (!isAllowedUrl(url)) throw IllegalArgumentException("invalid_url")
        val items = state.getJSONArray("items")
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            if (it.optString("type") == "url" && it.optString("url") == url) return it
        }
        val item = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("type", "url")
            .put("name", name?.trim().takeUnless { it.isNullOrEmpty() } ?: url)
            .put("url", url)
            .put("createdAt", nowIso())
        items.put(item)
        return item
    }

    private fun loadLocked(): JSONObject {
        if (!metaFile.exists()) {
            return JSONObject().put("items", JSONArray()).put("current", JSONObject.NULL)
        }
        return try {
            val o = JSONObject(metaFile.readText())
            if (!o.has("items")) o.put("items", JSONArray())
            o
        } catch (_: Exception) {
            JSONObject().put("items", JSONArray()).put("current", JSONObject.NULL)
        }
    }

    private fun saveLocked(state: JSONObject) {
        metaFile.parentFile?.mkdirs()
        metaFile.writeText(state.toString())
    }

    private fun notifyChanged() {
        listener?.invoke()
    }

    companion object {
        const val MAX_UPLOAD_BYTES = 6L * 1024L * 1024L * 1024L
        private val ALLOWED = setOf(
            "video/mp4", "video/webm", "video/quicktime", "video/ogg",
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
            "text/html", "text/css", "text/javascript", "application/javascript",
            "text/plain", "application/json",
        )
        private val EXT = mapOf(
            "mp4" to "video/mp4",
            "webm" to "video/webm",
            "mov" to "video/quicktime",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "png" to "image/png",
            "gif" to "image/gif",
            "webp" to "image/webp",
            "svg" to "image/svg+xml",
            "html" to "text/html",
            "htm" to "text/html",
            "css" to "text/css",
            "js" to "text/javascript",
            "txt" to "text/plain",
            "json" to "application/json",
        )
        private val ID_RE =
            Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

        fun isId(id: String) = ID_RE.matches(id)

        fun sanitizeName(name: String): String {
            val base = name.substringAfterLast('/').substringAfterLast('\\')
            val cleaned = base.replace(Regex("""[^\w.\- ()\[\]]+"""), "_").take(180)
            return cleaned.ifBlank { "file" }
        }

        fun resolveMime(filename: String, mime: String?): String? {
            val clean = (mime ?: "").substringBefore(';').trim().lowercase()
            val guessed = EXT[filename.substringAfterLast('.', "").lowercase()]
            if (clean in ALLOWED) return if (clean == "application/javascript") "text/javascript" else clean
            if (guessed != null && guessed in ALLOWED) return guessed
            return null
        }

        fun isAllowedUrl(url: String): Boolean {
            return try {
                val u = java.net.URI(url)
                val scheme = u.scheme?.lowercase()
                scheme == "http" || scheme == "https"
            } catch (_: Exception) {
                false
            }
        }

        fun isVideo(mime: String?) = mime?.startsWith("video/") == true

        private fun nowIso() = java.time.Instant.now().toString()
    }
}
