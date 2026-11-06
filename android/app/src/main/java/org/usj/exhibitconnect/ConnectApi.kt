package org.usj.exhibitconnect

import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object ConnectApi {
    private fun conn(url: String, method: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 2500
        c.readTimeout = 2500
        c.setRequestProperty("Content-Type", "application/json")
        return c
    }

    fun status(base: String): JSONObject {
        val c = conn("${base.trimEnd('/')}/__exhibit-connect/v1/status", "GET")
        c.inputStream.bufferedReader().use {
            return JSONObject(it.readText())
        }
    }

    fun post(base: String, path: String, body: JSONObject): Pair<Int, JSONObject> {
        val c = conn("${base.trimEnd('/')}/__exhibit-connect/v1$path", "POST")
        c.doOutput = true
        OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.readText().orEmpty()
        val json = if (text.isBlank()) JSONObject() else JSONObject(text)
        return code to json
    }
}
