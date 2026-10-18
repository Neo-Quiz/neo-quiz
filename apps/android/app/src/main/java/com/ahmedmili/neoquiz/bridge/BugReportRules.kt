package com.ahmedmili.neoquiz.bridge

import java.net.URI
import org.json.JSONObject

/**
 * The deployment constants of the in-app bug report, copies of `src/bug-report-config.ts`
 * (`check:android-pont` asserts they are equal). The page is untrusted, so it never supplies
 * them. While either is empty every `bugReport.*` channel answers `disabled`.
 */
object BugReportConfig {
    const val RELAY_URL = ""
    const val GITHUB_CLIENT_ID = ""
    val configured: Boolean get() = RELAY_URL.isNotEmpty() && GITHUB_CLIENT_ID.isNotEmpty()
}

/** Pure rules of the bug report channels; mirrors `bug-report/host-rule.ts` and `src/bug-report.ts`. */
object BugReportRules {
    const val BODY_MAX_BYTES = 16384
    const val RESPONSE_MAX_BYTES = 64 * 1024
    const val TIMEOUT_MS = 15_000
    const val MIN_INTERVAL_MS = 5_000L

    private val KEYS = setOf("v", "title", "what", "steps", "expected", "env", "log", "githubToken")
    private val TEXT_KEYS = listOf("title", "steps", "expected", "log", "githubToken")

    /** https only, exactly the relay host, github.com or api.github.com, default port, no credentials. */
    fun isAllowedHost(url: String, relay: String): Boolean {
        val u = try { URI(url) } catch (_: Exception) { return false }
        val r = try { URI(relay) } catch (_: Exception) { return false }
        if (u.scheme?.lowercase() != "https" || r.scheme?.lowercase() != "https") return false
        if (u.rawUserInfo != null || r.rawUserInfo != null) return false
        if (u.port != -1 || r.port != -1) return false
        val h = u.host?.lowercase() ?: return false
        val rh = r.host?.lowercase() ?: return false
        return h == rh || h == "github.com" || h == "api.github.com"
    }

    /** First screen only: the Worker stays the authority on every cap. */
    fun acceptsBody(json: String): Boolean {
        if (json.toByteArray(Charsets.UTF_8).size > BODY_MAX_BYTES) return false
        val o = try { JSONObject(json) } catch (_: Exception) { return false }
        if (o.keys().asSequence().any { it !in KEYS }) return false
        val v = o.opt("v")
        if (!((v is Int && v == 1) || (v is Long && v == 1L))) return false
        val what = o.opt("what") as? String ?: return false
        if (what.isBlank()) return false
        if (TEXT_KEYS.any { o.has(it) && o.opt(it) !is String }) return false
        if (o.has("env") && o.opt("env") !is JSONObject) return false
        return true
    }

    /** Delay before the next device-flow poll; GitHub's `slow_down` adds 5 s. A missing interval is 5 s. */
    fun deviceFlowDelayMs(interval: Int, slowDown: Boolean): Long =
        (if (interval < 1) 5 else interval) * 1000L + if (slowDown) 5000L else 0L
}
