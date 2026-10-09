package com.ahmedmili.neoquiz.bridge

import java.net.URI
import java.security.SecureRandom

/** What the route answers: status, body and headers (the WebView wrapper turns it into a `WebResourceResponse`). */
class FrameResponse(val status: Int, val body: ByteArray, val headers: Map<String, String>) {
    val ok get() = status == 200
}

/**
 * The interactive HTML pages of the quiz (`src/engine/html-frame-core.ts`), served to a sandboxed
 * `<iframe>` from the app's own origin: `https://appassets.androidplatform.net/__frame/<id>`.
 *
 * WHY A ROUTE: a `srcdoc` document INHERITS the CSP of the app (`script-src 'self'`), so the page's
 * scripts never ran (no interaction, no height report). A document fetched by URL has its OWN CSP,
 * the one in its response headers; nothing of the app's CSP is relaxed.
 *
 * ISOLATION (the page is hostile code: a shared quiz can carry it):
 *  - the frame keeps `sandbox="allow-scripts"` without `allow-same-origin`, and this response ALSO
 *    carries `sandbox allow-scripts` in its CSP: the document has an OPAQUE origin. The bridge
 *    (`neoAndroid`, the document-start shim) is injected by origin (`https://appassets...`), so it never
 *    exists in the frame, and the message listener answers only the main frame (`isMainFrame`);
 *  - a document is addressed by an unguessable 128-bit id, held in memory, and served ONCE;
 *  - only a sub-frame request is served; GET only;
 *  - the registry is bounded in count, in size and in age.
 */
class HtmlFrameStore(
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = ::randomId,
) {
    private class Entry(val bytes: ByteArray, val expires: Long)

    private val entries = LinkedHashMap<String, Entry>()

    /** Registers [doc] and returns its path (`/__frame/<id>`), or `null` when it is empty or too large. */
    @Synchronized
    fun publish(doc: String): String? {
        if (doc.isBlank()) return null
        val bytes = doc.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_BYTES) return null
        purge()
        while (entries.size >= MAX_ENTRIES) entries.remove(entries.keys.first())
        val id = newId()
        entries[id] = Entry(bytes, now() + TTL_MS)
        return PREFIX + id
    }

    /** The document of [id], removed on the way out: a second request for it finds nothing. */
    @Synchronized
    fun take(id: String): ByteArray? {
        purge()
        return entries.remove(id)?.bytes
    }

    @Synchronized
    fun size(): Int = entries.size

    private fun purge() {
        val t = now()
        entries.entries.removeAll { it.value.expires <= t }
    }

    companion object {
        const val PREFIX = "/__frame/"

        /** The page is capped at 200 KB by the renderer; the document adds its head (CSP, theme, height script). */
        const val MAX_BYTES = 200 * 1024 + 16 * 1024
        const val MAX_ENTRIES = 32
        const val TTL_MS = 60_000L

        /** Same text as `FRAME_CSP` in `html-frame-core.ts` (`check:android-pont` compares them) + the sandbox. */
        const val CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
            "font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; " +
            "sandbox allow-scripts"

        private val ID = Regex("^[0-9a-f]{32}$")

        val shared = HtmlFrameStore()

        private val random = SecureRandom()

        fun randomId(): String {
            val b = ByteArray(16)
            random.nextBytes(b)
            return b.joinToString("") { "%02x".format(it) }
        }

        /** The id in a frame URL of the app's own origin (https, no port, no user info, no query), else `null`. */
        fun idOf(url: String): String? {
            val uri = try {
                URI(url)
            } catch (_: Exception) {
                return null
            }
            if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != UrlPolicy.HOST || uri.port != -1 || uri.rawUserInfo != null) return null
            if (uri.rawQuery != null || uri.rawFragment != null) return null
            val path = uri.rawPath ?: return null
            if (!path.startsWith(PREFIX)) return null
            return path.substring(PREFIX.length).takeIf { ID.matches(it) }
        }

        /** True when the URL addresses this route (whatever follows the prefix): every such URL is answered here, never by the asset loader. */
        fun isFrameUrl(url: String): Boolean {
            val uri = try {
                URI(url)
            } catch (_: Exception) {
                return false
            }
            return uri.scheme?.lowercase() == "https" && uri.host?.lowercase() == UrlPolicy.HOST && uri.rawPath?.startsWith(PREFIX) == true
        }

        private fun headers() = mapOf(
            "Content-Security-Policy" to CSP,
            "X-Content-Type-Options" to "nosniff",
            "Cache-Control" to "no-store",
            "Referrer-Policy" to "no-referrer",
        )

        /** Answers a request: 200 with the document (once), else 403 (not a sub-frame GET) or 404 (unknown, used or expired id). */
        fun respond(store: HtmlFrameStore, url: String, method: String, isMainFrame: Boolean): FrameResponse {
            if (method != "GET" || isMainFrame) return FrameResponse(403, ByteArray(0), headers())
            val id = idOf(url) ?: return FrameResponse(404, ByteArray(0), headers())
            val body = store.take(id) ?: return FrameResponse(404, ByteArray(0), headers())
            return FrameResponse(200, body, headers())
        }
    }
}

/** `android.publierCadre(doc)`: the page hands the document of a frame, gets the path to load it from (or `null`). */
class HtmlFrameChannel(private val store: HtmlFrameStore = HtmlFrameStore.shared) {
    fun handlers(): Map<String, suspend (org.json.JSONArray) -> Any?> = mapOf(
        "android.publierCadre" to { args -> publish(args) },
    )

    fun publish(args: org.json.JSONArray): String? {
        val doc = args.opt(0) as? String ?: throw IllegalArgumentException("document expected")
        return store.publish(doc)
    }
}
