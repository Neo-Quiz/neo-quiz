package com.ahmedmili.neoquiz.bridge

import java.net.URI

enum class UrlDecision { ALLOW, EXTERNAL, BLOCK }

/**
 * Where the WebView may navigate. The page holds the bridge (files, settings):
 * only the app's own assets may load in it, a web link goes to the system
 * browser, and everything else (`file:`, `content:`, `intent:`, `javascript:`,
 * `data:`...) is dropped. The host is read by `URI`, so `host@evil.com` and
 * `host.evil.com` do not pass for the app.
 */
object UrlPolicy {
    const val HOST = "appassets.androidplatform.net"

    fun decide(url: String): UrlDecision {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return UrlDecision.BLOCK
        }
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()
        if (host.isNullOrEmpty()) return UrlDecision.BLOCK
        if (scheme == "https" && host == HOST && uri.port == -1 && uri.rawUserInfo == null && uri.rawPath?.startsWith("/assets/") == true) {
            return UrlDecision.ALLOW
        }
        return if (scheme == "https" || scheme == "http") UrlDecision.EXTERNAL else UrlDecision.BLOCK
    }

    /**
     * May the page LOAD this URL as a subresource (fetch, XHR, image, font, worker)?
     * Only the app's own origin, plus inline `data:` and `blob:` made by the page
     * itself. Everything else, notably `http://127.0.0.1:<port>` (the embedded
     * Syncthing REST port) and any Internet host, is refused: INTERNET is
     * granted to the app for Syncthing, not for the page.
     */
    fun mayLoad(url: String): Boolean {
        if (url.startsWith("data:", ignoreCase = true)) return true
        val target = if (url.startsWith("blob:", ignoreCase = true)) url.substring(5) else url
        val uri = try {
            URI(target)
        } catch (_: Exception) {
            return false
        }
        return uri.scheme?.lowercase() == "https" && uri.host?.lowercase() == HOST && uri.port == -1 && uri.rawUserInfo == null
    }

    /**
     * Content-Security-Policy of every response. Exceptions to 'self' and why:
     * style-src 'unsafe-inline' (the renderer and MathJax/MathLive set inline styles),
     * img/font data: (inlined fonts and icons), blob: (images and workers built by the page).
     */
    const val CSP = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; " +
        "style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob: data:; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}
