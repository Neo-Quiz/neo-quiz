package com.ahmedmili.neoquiz.code

import java.net.URI
import org.json.JSONObject

/**
 * The pure rules of the code sandbox, no Android type: what the hidden WebView
 * may be served, under which headers, and what may go in and out of it. The
 * counterpart of `resoudreFichierCode`, `CSP` and `normaliserResultat` in
 * `apps/windows/electron/code-sandbox.ts`, and `canaux.ts`'s job validation.
 */
object CodeProtocol {
    const val HOST = "code.appassets.androidplatform.net"
    const val ORIGIN = "https://$HOST"
    const val PAGE_URL = "$ORIGIN/index.html"

    /** The same constant as `CSP` in code-sandbox.ts: no `unsafe-eval`, so `Function` is refused in the worker. */
    const val CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'"

    /** The sandbox's own budgets, the PC's (`SECOURS_MS`, `CHARGEMENT_MS`, `INACTIVITE_MS`, `PLAFOND_FILE`). */
    const val FALLBACK_MS = 3000L
    const val LOADING_MS = 35000L
    const val IDLE_MS = 10 * 60 * 1000L
    const val QUEUE_LIMIT = 8

    private const val CODE_LIMIT = 64 * 1024
    private val LANGUAGES = setOf("python", "c", "cpp")

    // Same shape as SAFE_SEGMENT / DOS_DEVICE of code-sandbox.ts.
    private val SAFE_SEGMENT = Regex("^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$")
    private val DOS_DEVICE = Regex("^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[.].*)?$", RegexOption.IGNORE_CASE)

    /**
     * The asset (under `assets/code/`) a request designates, or null: only
     * `https` on the code host itself, no port, no user info, and every path
     * segment a plain file name (no `..`, `:`, backslash, empty segment, dot
     * at either end). The percent-encoded form is refused rather than decoded.
     */
    fun assetPathFor(url: String): String? {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != HOST) return null
        if (uri.port != -1 || uri.rawUserInfo != null) return null
        val path = uri.rawPath ?: return null
        val rel = path.removePrefix("/")
        if (rel.isEmpty()) return null
        val segments = rel.split("/")
        if (!segments.all { SAFE_SEGMENT.matches(it) && !DOS_DEVICE.matches(it) }) return null
        return "code/$rel"
    }

    fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "wasm" -> "application/wasm"
        "json" -> "application/json"
        "zip" -> "application/zip"
        "tar" -> "application/x-tar"
        else -> "text/plain"
    }

    /** Headers of EVERY response of the code origin, errors included. */
    fun headers(): Map<String, String> = mapOf(
        "Content-Security-Policy" to CSP,
        "Cache-Control" to "no-store",
        "X-Content-Type-Options" to "nosniff",
    )

    class Job(val language: String, val code: String, val stdin: String, val after: String?, val timeoutMs: Int)

    /** The job the page may run, or null (`job refused`): same checks and clamp as canaux.ts. */
    fun parseJob(raw: Any?): Job? {
        val o = raw as? JSONObject ?: return null
        val language = o.opt("language") as? String ?: return null
        if (language !in LANGUAGES) return null
        val code = o.opt("code") as? String ?: return null
        val stdin = if (o.has("stdin") && !o.isNull("stdin")) o.opt("stdin") as? String ?: return null else ""
        val after = if (o.has("after") && !o.isNull("after")) o.opt("after") as? String ?: return null else null
        if (code.length > CODE_LIMIT || stdin.length > CODE_LIMIT || (after?.length ?: 0) > CODE_LIMIT) return null
        val t = (o.opt("timeoutMs") as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: 5000.0
        return Job(language, code, stdin, after, t.coerceIn(100.0, 10000.0).toInt())
    }

    private val STATUSES = setOf("ok", "error", "compile-error", "timeout", "too-long", "unavailable", "not-installed")
    private const val OUTPUT_LIMIT = 20000

    /** What comes back from the page is untrusted: only the contract's fields, typed and capped. */
    fun normalise(raw: Any?): JSONObject {
        val o = raw as? JSONObject
        val status = (o?.opt("status") as? String)?.takeIf { it in STATUSES } ?: "error"
        val stdout = (o?.opt("stdout") as? String)?.take(OUTPUT_LIMIT) ?: ""
        val out = JSONObject().put("status", status).put("stdout", stdout)
        (o?.opt("error") as? String)?.let { out.put("error", it.take(OUTPUT_LIMIT)) }
        return out
    }

    fun result(status: String, stdout: String = "", error: String? = null): JSONObject =
        JSONObject().put("status", status).put("stdout", stdout).also { if (error != null) it.put("error", error) }
}
