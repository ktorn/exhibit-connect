package org.usj.exhibitconnect

import android.content.res.AssetManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.min

class ContentHttpServer(
    private val store: ContentStore,
    private val assets: AssetManager,
    private val checkPin: (String) -> Boolean,
    private val exhibitId: String,
    private val displayName: String,
    preferredPort: Int = DEFAULT_PORT,
) {
    @Volatile private var running = false
    private var server: ServerSocket? = null
    private var thread: Thread? = null
    private val pool = Executors.newCachedThreadPool()
    var port: Int = preferredPort
        private set

    fun start() {
        if (running) return
        var last: Exception? = null
        val candidates = listOf(port, 41235, 41236, 41237, 0)
        for (p in candidates.distinct()) {
            try {
                server = ServerSocket(p, 50, InetAddress.getByName("0.0.0.0"))
                port = server!!.localPort
                last = null
                break
            } catch (e: Exception) {
                last = e
            }
        }
        if (server == null) throw last ?: IllegalStateException("bind failed")
        running = true
        thread = Thread {
            while (running) {
                try {
                    val socket = server?.accept() ?: break
                    pool.execute { handle(socket) }
                } catch (_: Exception) {
                    if (!running) break
                }
            }
        }.also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        try {
            server?.close()
        } catch (_: Exception) {
        }
        server = null
        thread = null
        pool.shutdownNow()
    }

    private fun handle(socket: Socket) {
        socket.soTimeout = 60_000
        try {
            val input = BufferedInputStream(socket.getInputStream())
            val headerBytes = readHeaders(input)
            if (headerBytes.isEmpty()) return
            val text = String(headerBytes, Charsets.ISO_8859_1)
            val lines = text.split("\r\n")
            val first = lines.firstOrNull() ?: return
            val parts = first.split(" ")
            if (parts.size < 2) {
                writeJson(socket.getOutputStream(), 400, err("invalid_request", "Bad request line"))
                return
            }
            val method = parts[0].uppercase()
            val uri = parts[1]
            val headers = mutableMapOf<String, String>()
            for (line in lines.drop(1)) {
                if (line.isEmpty()) continue
                val c = line.indexOf(':')
                if (c > 0) {
                    headers[line.substring(0, c).trim().lowercase()] = line.substring(c + 1).trim()
                }
            }
            val path = URLDecoder.decode(uri.substringBefore('?'), "UTF-8")
            if (method == "POST" && stripPrefix(path) == "/content/files") {
                socket.soTimeout = 0
            }
            val out = socket.getOutputStream()
            route(method, path, headers, input, out)
        } catch (e: Exception) {
            try {
                writeJson(socket.getOutputStream(), 500, err("internal_error", e.message ?: "error"))
            } catch (_: Exception) {
            }
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun route(
        method: String,
        path: String,
        headers: Map<String, String>,
        input: BufferedInputStream,
        out: OutputStream,
    ) {
        val rel = stripPrefix(path)
        if (method == "OPTIONS") {
            write(out, 204, "text/plain", ByteArray(0), extra = cors())
            return
        }
        if (method == "GET" && isManagerHtml(rel)) {
            serveAsset(out, "manager.html", "text/html; charset=utf-8")
            return
        }
        if (method == "GET" && (rel == "/manager.js" || rel == "manager.js")) {
            serveAsset(out, "manager.js", "text/javascript; charset=utf-8")
            return
        }
        if (method == "GET" && rel == "/status") {
            writeJson(out, 200, statusJson())
            return
        }
        if (method == "GET" && rel == "/content") {
            writeJson(out, 200, decorate(store.snapshot()))
            return
        }
        if (method == "GET" && rel.startsWith("/content/files/")) {
            val id = rel.removePrefix("/content/files/").substringBefore('/')
            serveFile(out, headers, id)
            return
        }
        if (method == "POST" && rel == "/content/files") {
            if (!requirePin(headers, out)) return
            val ct = headers["content-type"] ?: ""
            if (!ct.lowercase().contains("multipart/form-data")) {
                writeJson(out, 415, err("unsupported_media", "multipart/form-data required"))
                return
            }
            val length = headers["content-length"]?.toLongOrNull()
            if (length == null) {
                writeJson(out, 411, err("length_required", "Content-Length required"))
                return
            }
            if (length > ContentStore.MAX_UPLOAD_BYTES) {
                drain(input, length)
                writeJson(out, 413, err("too_large", "File exceeds upload limit"))
                return
            }
            val tmp = File.createTempFile("ec-up-", ".bin")
            val id = UUID.randomUUID().toString()
            val dest = store.filePath(id)
            try {
                copyN(input, tmp, length)
                val part = Multipart.extractFile(tmp, ct, dest)
                val mime = ContentStore.resolveMime(part.filename, part.mime)
                    ?: throw IllegalArgumentException("unsupported_type")
                val item = store.addFile(id, part.filename, mime, part.size)
                writeJson(out, 201, JSONObject().put("ok", true).put("item", item))
            } catch (e: IllegalArgumentException) {
                dest.delete()
                val code = e.message ?: "invalid"
                val status = if (code == "unsupported_type") 415 else 400
                writeJson(out, status, err(code, e.message ?: "Bad upload"))
            } finally {
                tmp.delete()
            }
            return
        }
        if (method == "POST" && rel == "/content/urls") {
            if (!requirePin(headers, out)) return
            val body = readJson(headers, input)
            try {
                val url = body.optString("url").trim()
                val item = store.addUrl(url, body.optString("name").ifBlank { null })
                if (body.optBoolean("current", true)) {
                    store.setCurrent(JSONObject().put("type", "url").put("url", item.getString("url")))
                }
                writeJson(out, 201, JSONObject().put("ok", true).put("item", item).put("content", decorate(store.snapshot())))
            } catch (e: IllegalArgumentException) {
                writeJson(out, 400, err(e.message ?: "invalid_url", "http(s) URL required"))
            }
            return
        }
        if (method == "PUT" && rel == "/content/current") {
            if (!requirePin(headers, out)) return
            val body = readJson(headers, input)
            try {
                store.setCurrent(body)
                writeJson(out, 200, JSONObject().put("ok", true).put("content", decorate(store.snapshot())))
            } catch (e: IllegalArgumentException) {
                val code = e.message ?: "invalid_body"
                val status = if (code == "not_found") 404 else 400
                writeJson(out, status, err(code, e.message ?: "Bad current"))
            }
            return
        }
        if (method == "DELETE" && rel.startsWith("/content/")) {
            if (!requirePin(headers, out)) return
            val id = rel.removePrefix("/content/").substringBefore('/')
            if (id == "files" || id == "current" || id == "urls") {
                writeJson(out, 404, err("not_found", "Unknown route"))
                return
            }
            if (!ContentStore.isId(id)) {
                writeJson(out, 400, err("invalid_id", "Bad content id"))
                return
            }
            try {
                store.remove(id)
                writeJson(out, 200, JSONObject().put("ok", true).put("content", decorate(store.snapshot())))
            } catch (e: IllegalArgumentException) {
                writeJson(out, 404, err("not_found", "Not found"))
            }
            return
        }
        drain(input, headers["content-length"]?.toLongOrNull() ?: 0L)
        writeJson(out, 404, err("not_found", "Unknown route"))
    }

    private fun statusJson(): JSONObject {
        val snap = store.snapshot()
        val current = snap.optJSONObject("current")
        val lan = LanHost.pick()
        val httpBase = if (lan != null) "http://$lan:$port" else null
        return JSONObject()
            .put("v", 1)
            .put("exhibitId", exhibitId)
            .put("displayName", displayName)
            .put("role", "display")
            .put("capabilities", JSONArray().put("content"))
            .put("auth", JSONObject().put("mutate", "pin"))
            .put("paired", false)
            .put("discoveryEnabled", false)
            .put("tabletConnected", false)
            .put("lanHost", lan)
            .put("httpBase", httpBase)
            .put(
                "content",
                JSONObject()
                    .put("current", current ?: JSONObject.NULL)
                    .put("itemCount", snap.optJSONArray("items")?.length() ?: 0),
            )
    }

    private fun decorate(state: JSONObject): JSONObject {
        val lan = LanHost.pick()
        val base = if (lan != null) "http://$lan:$port" else "http://127.0.0.1:$port"
        val itemsIn = state.optJSONArray("items") ?: JSONArray()
        val items = JSONArray()
        for (i in 0 until itemsIn.length()) {
            val it = JSONObject(itemsIn.getJSONObject(i).toString())
            if (it.optString("type") == "file") {
                it.put("url", "$base$PREFIX/content/files/${it.getString("id")}")
            }
            items.put(it)
        }
        val currentIn = state.optJSONObject("current")
        val current = if (currentIn == null) {
            JSONObject.NULL
        } else {
            val c = JSONObject(currentIn.toString())
            if (c.optString("type") == "file") {
                c.put("url", "$base$PREFIX/content/files/${c.getString("id")}")
            }
            c
        }
        return JSONObject()
            .put("v", 1)
            .put("items", items)
            .put("current", current)
            .put("maxUploadBytes", ContentStore.MAX_UPLOAD_BYTES)
    }

    private fun serveFile(out: OutputStream, headers: Map<String, String>, id: String) {
        if (!ContentStore.isId(id)) {
            writeJson(out, 400, err("invalid_id", "Bad content id"))
            return
        }
        val state = store.snapshot()
        val item = store.find(state, id)
        if (item == null || item.optString("type") != "file") {
            writeJson(out, 404, err("not_found", "File not found"))
            return
        }
        val file = store.filePath(id)
        if (!file.isFile) {
            writeJson(out, 404, err("not_found", "File missing on disk"))
            return
        }
        val mime = item.optString("mime", "application/octet-stream")
        val size = file.length()
        val range = parseRange(headers["range"], size)
        val extra = cors() + mapOf(
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "no-store",
            "Content-Type" to mime,
        )
        if (headers["range"] != null && range == null) {
            write(out, 416, mime, ByteArray(0), extra + mapOf("Content-Range" to "bytes */$size"))
            return
        }
        val start = range?.first ?: 0L
        val end = range?.second ?: (size - 1)
        val length = end - start + 1
        val code = if (range != null) 206 else 200
        val rangeHeaders = if (range != null) extra + mapOf("Content-Range" to "bytes $start-$end/$size") else extra
        val head = StringBuilder()
        head.append("HTTP/1.1 $code ${reason(code)}\r\n")
        for ((k, v) in rangeHeaders) head.append("$k: $v\r\n")
        head.append("Content-Length: $length\r\nConnection: close\r\n\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        file.inputStream().use { input ->
            input.skip(start)
            var left = length
            val buf = ByteArray(64 * 1024)
            while (left > 0) {
                val n = input.read(buf, 0, min(buf.size.toLong(), left).toInt())
                if (n <= 0) break
                out.write(buf, 0, n)
                left -= n
            }
        }
        out.flush()
    }

    private fun serveAsset(out: OutputStream, name: String, mime: String) {
        try {
            val bytes = assets.open("manager/$name").use { it.readBytes() }
            write(out, 200, mime, bytes, extra = cors() + mapOf("Cache-Control" to "no-store"))
        } catch (_: Exception) {
            writeJson(out, 404, err("not_found", "Manager UI not bundled"))
        }
    }

    private fun requirePin(headers: Map<String, String>, out: OutputStream): Boolean {
        val pin = headers["x-exhibit-pin"].orEmpty()
        val admin = headers["x-exhibit-admin-token"].orEmpty()
        val raw = headers["authorization"].orEmpty()
        val bearer = if (raw.lowercase().startsWith("bearer ")) raw.substring(7).trim() else ""
        val ok = listOf(pin, admin, bearer).any { it.isNotEmpty() && checkPin(it) }
        if (!ok) {
            writeJson(out, 401, err("unauthorized", "Staff PIN required"))
        }
        return ok
    }

    private fun readJson(headers: Map<String, String>, input: BufferedInputStream): JSONObject {
        val n = headers["content-length"]?.toIntOrNull() ?: 0
        if (n <= 0) return JSONObject()
        val buf = ByteArray(n)
        var off = 0
        while (off < n) {
            val r = input.read(buf, off, n - off)
            if (r < 0) break
            off += r
        }
        val text = String(buf, 0, off, Charsets.UTF_8).trim()
        if (text.isEmpty()) return JSONObject()
        return JSONObject(text)
    }

    companion object {
        const val DEFAULT_PORT = 41235
        const val PREFIX = "/__exhibit-connect/v1"

        fun localFileUrl(port: Int, id: String) = "http://127.0.0.1:$port$PREFIX/content/files/$id"

        private fun stripPrefix(path: String): String {
            val p = if (path.startsWith(PREFIX)) path.substring(PREFIX.length) else path
            val trimmed = if (p.isEmpty()) "/" else p
            return if (trimmed.startsWith("/")) trimmed else "/$trimmed"
        }

        private fun isManagerHtml(rel: String) =
            rel == "/" || rel == "/manager" || rel == "/manager.html"

        private fun err(code: String, message: String) =
            JSONObject().put("error", code).put("message", message)

        private fun cors() = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers" to "Content-Type, Authorization, X-Exhibit-Pin, X-Exhibit-Admin-Token",
        )

        private fun parseRange(header: String?, size: Long): Pair<Long, Long>? {
            if (header == null || !header.startsWith("bytes=")) return null
            val part = header.removePrefix("bytes=").substringBefore(',').trim()
            val dash = part.indexOf('-')
            if (dash < 0) return null
            val startStr = part.substring(0, dash)
            val endStr = part.substring(dash + 1)
            val start: Long
            val end: Long
            if (startStr.isEmpty()) {
                val suffix = endStr.toLongOrNull() ?: return null
                start = maxOf(0L, size - suffix)
                end = size - 1
            } else {
                start = startStr.toLongOrNull() ?: return null
                end = if (endStr.isEmpty()) size - 1 else endStr.toLongOrNull() ?: return null
            }
            if (start >= size || start > end) return null
            return start to min(end, size - 1)
        }

        private fun readHeaders(input: BufferedInputStream): ByteArray {
            val buf = ByteArrayOutputStream()
            var matched = 0
            val end = byteArrayOf(13, 10, 13, 10)
            while (true) {
                val b = input.read()
                if (b < 0) break
                buf.write(b)
                if (b.toByte() == end[matched]) {
                    matched += 1
                    if (matched == 4) break
                } else {
                    matched = if (b.toByte() == end[0]) 1 else 0
                }
                if (buf.size() > 64_000) throw IllegalArgumentException("headers too large")
            }
            return buf.toByteArray()
        }

        private fun copyN(input: BufferedInputStream, dest: File, length: Long) {
            dest.outputStream().use { out ->
                var left = length
                val buf = ByteArray(64 * 1024)
                while (left > 0) {
                    val n = input.read(buf, 0, min(buf.size.toLong(), left).toInt())
                    if (n < 0) break
                    out.write(buf, 0, n)
                    left -= n
                }
            }
        }

        private fun drain(input: BufferedInputStream, length: Long) {
            var left = length
            val buf = ByteArray(8 * 1024)
            while (left > 0) {
                val n = input.read(buf, 0, min(buf.size.toLong(), left).toInt())
                if (n < 0) break
                left -= n
            }
        }

        private fun writeJson(out: OutputStream, code: Int, body: JSONObject) {
            write(out, code, "application/json", body.toString().toByteArray(Charsets.UTF_8), extra = cors())
        }

        private fun write(
            out: OutputStream,
            code: Int,
            mime: String,
            body: ByteArray,
            extra: Map<String, String> = emptyMap(),
        ) {
            val head = StringBuilder()
            head.append("HTTP/1.1 $code ${reason(code)}\r\n")
            head.append("Content-Type: $mime\r\n")
            head.append("Content-Length: ${body.size}\r\n")
            head.append("Connection: close\r\n")
            for ((k, v) in extra) head.append("$k: $v\r\n")
            head.append("\r\n")
            out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
            if (body.isNotEmpty()) out.write(body)
            out.flush()
        }

        private fun reason(code: Int) = when (code) {
            200 -> "OK"
            201 -> "Created"
            204 -> "No Content"
            206 -> "Partial Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            411 -> "Length Required"
            413 -> "Payload Too Large"
            415 -> "Unsupported Media Type"
            416 -> "Range Not Satisfiable"
            else -> "Error"
        }
    }
}
