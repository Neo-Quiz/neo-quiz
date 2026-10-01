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
}
