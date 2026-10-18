package com.ahmedmili.neoquiz.bridge

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/** One blocking HTTPS request; returns the parsed JSON body or throws. Judges the JSON shape, never the status. */
fun interface BugReportHttp {
    fun request(method: String, url: String, headers: Map<String, String>, body: String?): JSONObject
}

/** Real transport: https, redirects never followed, 15 s timeouts, response capped at 64 KB. */
class UrlBugReportHttp : BugReportHttp {
    override fun request(method: String, url: String, headers: Map<String, String>, body: String?): JSONObject {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            conn.instanceFollowRedirects = false
            conn.requestMethod = method
            conn.connectTimeout = BugReportRules.TIMEOUT_MS
            conn.readTimeout = BugReportRules.TIMEOUT_MS
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            if (status in 300..399) throw IOException("redirect refused")
            val stream = (if (status in 200..299) conn.inputStream else conn.errorStream) ?: throw IOException("no body")
            val buf = java.io.ByteArrayOutputStream()
            stream.use { s ->
                val chunk = ByteArray(8192)
                while (true) {
                    val n = s.read(chunk)
                    if (n < 0) break
                    if (buf.size() + n > BugReportRules.RESPONSE_MAX_BYTES) throw IOException("answer too large")
                    buf.write(chunk, 0, n)
                }
            }
            return JSONObject(buf.toString("UTF-8"))
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * The seven `bugReport.*` channels, the Android twin of `electron/bug-report/service.ts` and
 * `device-flow.ts`. The page hands text and gets a result; the GitHub token goes to the Keystore store
 * and never appears in a return value (only the login does). No log on Android in v1.
 */
class BugReportChannel(
    private val scope: CoroutineScope,
    private val store: SessionStore,
    private val http: BugReportHttp,
    private val env: () -> JSONObject,
    private val relay: String = BugReportConfig.RELAY_URL,
    private val clientId: String = BugReportConfig.GITHUB_CLIENT_ID,
    private val now: () -> Long = System::currentTimeMillis,
    private val pause: suspend (Long, CompletableDeferred<Unit>) -> Unit = { ms, abort -> withTimeoutOrNull(ms) { abort.await() }; Unit },
) {
    private class Flow(val deviceCode: String, var interval: Int, val limit: Long) {
        val abort = CompletableDeferred<Unit>()
    }

    private val enabled get() = relay.isNotEmpty() && clientId.isNotEmpty()
    private val lock = Any()
    private var flow: Flow? = null
    private var starting = false
    private var generation = 0
    private var sending = false
    private var lastSend: Long? = null
    private var waiting: Deferred<JSONObject>? = null

    private fun disabled() = JSONObject().put("ok", false).put("code", "disabled")
    private fun failure(code: String) = JSONObject().put("ok", false).put("code", code)
    private fun error(code: String) = JSONObject().put("error", code)

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "bugReport.preview" to { _ -> preview() },
        "bugReport.send" to { a -> send(a.opt(0)) },
        "bugReport.github.connect" to { _ -> connect() },
        "bugReport.github.wait" to { _ -> awaitLogin() },
        "bugReport.github.cancel" to { _ -> cancel() },
        "bugReport.github.state" to { _ -> state() },
        "bugReport.github.disconnect" to { _ -> disconnect() },
    )

    private fun preview(): JSONObject =
        if (!enabled) disabled() else JSONObject().put("ok", true).put("env", env()).put("log", "")

    private suspend fun post(report: JSONObject): JSONObject {
        val body = report.toString()
        // The token is added after the 16 KB check on the report itself; leave room for it only.
        if (body.toByteArray(Charsets.UTF_8).size > BugReportRules.BODY_MAX_BYTES + 300) return failure("invalid")
        val url = relay.trimEnd('/') + "/report"
        if (!BugReportRules.isAllowedHost(url, relay)) return failure("upstream")
        val j = try {
            withContext(Dispatchers.IO) {
                http.request("POST", url, mapOf("Content-Type" to "application/json", "Accept" to "application/json"), body)
            }
        } catch (_: Exception) {
            return failure("upstream")
        }
        if (j.opt("ok") == true) {
            val u = j.opt("url") as? String
            val n = j.opt("number")
            val isInt = n is Int || n is Long
            return if (u != null && BugReportRules.isAllowedHost(u, relay) && isInt) {
                JSONObject().put("ok", true).put("url", u).put("number", n)
            } else {
                failure("upstream")
            }
        }
        val code = j.opt("code") as? String
        return if (j.opt("ok") == false && code != null && code in CODES) failure(code) else failure("upstream")
    }

    private suspend fun send(raw: Any?): JSONObject {
        if (!enabled) return disabled()
        val report = raw as? JSONObject ?: return failure("invalid")
        if (!BugReportRules.acceptsBody(report.toString())) return failure("invalid")
        val t = now()
        synchronized(lock) {
            if (sending) return failure("rate_limited")
            val last = lastSend
            if (last != null && t - last < BugReportRules.MIN_INTERVAL_MS) return failure("rate_limited")
            sending = true
            lastSend = t
        }
        try {
            // The page supplies neither the token, the environment's value nor a log (none exists on Android):
            // it only says whether to send the environment (its `env` key present), and we fill it in.
            val base = JSONObject(report.toString())
            base.remove("githubToken")
            base.remove("log")
            if (report.has("env")) base.put("env", env()) else base.remove("env")
            if (base.toString().toByteArray(Charsets.UTF_8).size > BugReportRules.BODY_MAX_BYTES) return failure("invalid")
            val session = store.read()
            val r = post(if (session != null) JSONObject(base.toString()).put("githubToken", session.accessToken) else base)
            if (r.optBoolean("ok") || r.optString("code") != "token_invalid") return r
            // Revoked token: forget the session, retry once anonymously.
            runCatching { store.clear() }
            val r2 = post(base)
            return if (!r2.optBoolean("ok") && r2.optString("code") == "token_invalid") failure("upstream") else r2
        } finally {
            synchronized(lock) { sending = false }
        }
    }

    private suspend fun connect(): JSONObject {
        if (!enabled) return disabled()
        synchronized(lock) {
            val f = flow
            // A flow left behind (page reloaded, never awaited) is free once past its expiry.
            if (f != null && now() >= f.limit) {
                f.abort.complete(Unit)
                flow = null
            }
            if (starting || flow != null) return failure("busy")
            starting = true
        }
        try {
            val j = try {
                withContext(Dispatchers.IO) {
                    http.request("POST", "https://github.com/login/device/code", JSON_HEADERS, JSONObject().put("client_id", clientId).toString())
                }
            } catch (_: Exception) {
                return failure("failed")
            }
            val device = j.opt("device_code") as? String
            val user = j.opt("user_code") as? String
            val uri = j.opt("verification_uri") as? String
            val expires = (j.opt("expires_in") as? Number)?.toInt()
            if (device == null || user == null || uri == null || expires == null || expires <= 0) return failure("failed")
            if (user.length > 32 || !BugReportRules.isAllowedHost(uri, relay)) return failure("refused")
            val interval = (j.opt("interval") as? Number)?.toInt() ?: 0
            synchronized(lock) { flow = Flow(device, interval, now() + expires * 1000L) }
            return JSONObject().put("ok", true).put("userCode", user).put("verificationUri", uri).put("expiresIn", expires)
        } finally {
            synchronized(lock) { starting = false }
        }
    }

    private suspend fun awaitLogin(): JSONObject {
        val job = synchronized(lock) {
            // Single flight: later callers share the one poll.
            waiting ?: scope.async {
                val g = synchronized(lock) { generation }
                try {
                    finish(g)
                } finally {
                    synchronized(lock) { waiting = null }
                }
            }.also { waiting = it }
        }
        return job.await()
    }

    private suspend fun finish(g: Int): JSONObject {
        val r = poll()
        if (r.has("error")) return r
        val session = GithubSession(r.getString("accessToken"), r.getString("login"))
        if (synchronized(lock) { g != generation }) return error("cancelled")
        try {
            store.write(session)
        } catch (_: Exception) {
            return error("failed")
        }
        if (synchronized(lock) { g != generation }) {
            runCatching { store.clear() }
            return error("cancelled")
        }
        return JSONObject().put("login", session.login)
    }

    /** The device-flow poll; returns `{accessToken, login}` (internal, never leaves this class) or `{error}`. */
    private suspend fun poll(): JSONObject {
        val f = synchronized(lock) { flow } ?: return error("failed")
        try {
            while (true) {
                pause(BugReportRules.deviceFlowDelayMs(f.interval, false), f.abort)
                if (f.abort.isCompleted) return error("cancelled")
                if (now() >= f.limit) return error("expired")
                val j = try {
                    withContext(Dispatchers.IO) {
                        http.request(
                            "POST", "https://github.com/login/oauth/access_token", JSON_HEADERS,
                            JSONObject().put("client_id", clientId).put("device_code", f.deviceCode)
                                .put("grant_type", "urn:ietf:params:oauth:grant-type:device_code").toString(),
                        )
                    }
                } catch (_: Exception) {
                    return error(if (f.abort.isCompleted) "cancelled" else "failed")
                }
                val token = j.opt("access_token") as? String
                if (token != null && token.isNotEmpty() && token.length <= 255) {
                    return try {
                        val u = withContext(Dispatchers.IO) {
                            http.request("GET", "https://api.github.com/user", JSON_HEADERS + ("Authorization" to "Bearer $token"), null)
                        }
                        val login = u.opt("login") as? String
                        if (login != null && LOGIN.matches(login)) JSONObject().put("accessToken", token).put("login", login) else error("failed")
                    } catch (_: Exception) {
                        error(if (f.abort.isCompleted) "cancelled" else "failed")
                    }
                }
                when (j.opt("error")) {
                    "authorization_pending" -> continue
                    "slow_down" -> {
                        f.interval = (if (f.interval < 1) 5 else f.interval) + 5
                        continue
                    }
                    "expired_token" -> return error("expired")
                    "access_denied" -> return error("denied")
                    else -> return error("failed")
                }
            }
        } finally {
            synchronized(lock) { if (flow === f) flow = null }
        }
    }

    private fun cancel() {
        val f = synchronized(lock) { flow.also { flow = null } }
        f?.abort?.complete(Unit)
    }

    private fun state(): JSONObject? = store.read()?.let { JSONObject().put("login", it.login) }

    private fun disconnect() {
        synchronized(lock) { generation++ }
        cancel()
        runCatching { store.clear() }
    }

    private companion object {
        val JSON_HEADERS = mapOf("Accept" to "application/json", "User-Agent" to "Neo-Quiz", "Content-Type" to "application/json")
        val CODES = setOf("invalid", "rate_limited", "duplicate", "upstream", "disabled", "token_invalid")
        val LOGIN = Regex("^[A-Za-z0-9-]{1,39}$")
    }
}
