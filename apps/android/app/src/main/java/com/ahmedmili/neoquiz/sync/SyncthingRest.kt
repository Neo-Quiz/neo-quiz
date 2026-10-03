package com.ahmedmili.neoquiz.sync

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

/**
 * The REST client of the embedded Syncthing, mirror of
 * `apps/windows/electron/syncthing-rest.ts` (Task 6). Only the calls the three
 * bridge verbs and the sync loop NEED exist here. Every call sends `X-API-Key`
 * (the key lives in Kotlin memory, never in a file and never in the page),
 * every non-2xx status throws, and every id that becomes a path segment is
 * checked first: a device or folder id never carries a `/`, a `..` or a query
 * string into the URL. Calls BLOCK: run them on `Dispatchers.IO`.
 */
class SyncthingRest(private val port: Int, private val apiKey: String) {
    private val base = "http://127.0.0.1:$port"

    private fun call(method: String, path: String, body: JSONObject? = null, timeoutMs: Int = TIMEOUT_MS): String {
        val conn = URI(base + path).toURL().openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.setRequestProperty("X-API-Key", apiKey)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            if (status !in 200..299) throw IOException("syncthing REST $method ${path.substringBefore('?')}: HTTP $status")
            return text
        } finally {
            conn.disconnect()
        }
    }

    private fun obj(method: String, path: String, body: JSONObject? = null): JSONObject =
        call(method, path, body).let { if (it.isBlank()) JSONObject() else JSONObject(it) }

    private fun arr(method: String, path: String): JSONArray =
        call(method, path).let { if (it.isBlank()) JSONArray() else JSONArray(it) }

    fun ping() { call("GET", "/rest/system/ping") }

    fun myId(): String = obj("GET", "/rest/system/status").optString("myID").also { if (it.isEmpty()) throw IOException("syncthing: no device id in the status") }

    fun devices(): JSONArray = arr("GET", "/rest/config/devices")

    fun putDevice(d: JSONObject) { call("PUT", "/rest/config/devices/${segment(d.optString("deviceID"))}", d) }

    fun deleteDevice(id: String) { call("DELETE", "/rest/config/devices/${segment(id)}") }

    fun putFolder(f: JSONObject) { call("PUT", "/rest/config/folders/${segment(f.optString("id"))}", f) }

    fun patchFolder(id: String, partial: JSONObject) { call("PATCH", "/rest/config/folders/${segment(id)}", partial) }

    fun patchOptions(partial: JSONObject) { call("PATCH", "/rest/config/options", partial) }

    fun setIgnores(folderId: String, lines: List<String>) {
        call("POST", "/rest/db/ignores?folder=${segment(folderId)}", JSONObject().put("ignore", JSONArray(lines)))
    }

    fun pendingFolders(): JSONObject = obj("GET", "/rest/cluster/pending/folders")

    fun pendingDevices(): JSONObject = obj("GET", "/rest/cluster/pending/devices")

    /** Events after [since], long-polling at most [waitS] seconds (bounded to 1..10). */
    fun events(since: Long, types: List<String> = emptyList(), waitS: Int = 1): JSONArray {
        val filter = if (types.isEmpty()) "" else "&events=" + URLEncoder.encode(types.joinToString(","), "UTF-8")
        return arr("GET", "/rest/events?since=${maxOf(0, since)}&timeout=${waitS.coerceIn(1, 10)}$filter")
    }

    /** Scans these paths of the folder NOW (relative, '/'): what makes a change of the app leave at once. */
    fun scan(folderId: String, subs: List<String>) {
        val q = subs.take(50).joinToString("") { "&sub=" + URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        call("POST", "/rest/db/scan?folder=${segment(folderId)}$q")
    }

    fun folderStatus(id: String): JSONObject = obj("GET", "/rest/db/status?folder=${segment(id)}")

    /** Dismisses ONE pending device (the owner chose Ignore); it may come back the next time that device tries. */
    fun dismissPendingDevice(id: String) { call("DELETE", "/rest/cluster/pending/devices?device=${segment(id)}") }

    fun deviceStats(): JSONObject = obj("GET", "/rest/stats/device")

    fun connections(): JSONObject = obj("GET", "/rest/system/connections")

    fun shutdown() { call("POST", "/rest/system/shutdown") }

    private companion object {
        const val TIMEOUT_MS = 15_000
        val SEGMENT = Regex("^[A-Za-z0-9_-][A-Za-z0-9._-]*$")

        fun segment(s: String): String {
            require(SEGMENT.matches(s) && !s.contains("..")) { "syncthing: bad id in a path" }
            return URLEncoder.encode(s, "UTF-8")
        }
    }
}
