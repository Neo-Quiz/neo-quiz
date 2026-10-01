package com.ahmedmili.neoquiz.web

import android.annotation.SuppressLint
import android.app.Activity
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.ahmedmili.neoquiz.bridge.ResourceRoute
import com.ahmedmili.neoquiz.bridge.UrlDecision
import com.ahmedmili.neoquiz.bridge.UrlPolicy
import com.ahmedmili.neoquiz.bridge.createAppBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The WebView that hosts the renderer built by `apps/windows` (Vite).
 *
 * Message format (shared with `web/shim.ts` and every later bridge handler):
 *  - JS -> Kotlin: {"id":number,"canal":string,"args":any[]}
 *  - Kotlin -> JS reply: {"id":number,"ok":true,"valeur":any}
 *                     or {"id":number,"ok":false,"erreur":string}
 *  - Kotlin -> JS event: {"evenement":string,"donnees":any}
 */
@SuppressLint("SetJavaScriptEnabled")
class AppWebView(private val activity: Activity) : WebView(activity) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val app = createAppBridge(activity, scope)
    private val bridge = app.bridge

    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain(HOST)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(activity))
        .build()

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = false

        // Hardware-accelerated (the default; never `LAYER_TYPE_SOFTWARE`) and the Android 12+ stretch
        // at the document's top and bottom edge, which WebView draws for the root scroller only.
        setLayerType(LAYER_TYPE_NONE, null)
        overScrollMode = OVER_SCROLL_ALWAYS

        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                // The app holds INTERNET for Syncthing: the page may reach nothing but its own assets
                // (no Internet host, no http://127.0.0.1:<REST port>).
                if (!UrlPolicy.mayLoad(request.url.toString())) {
                    return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", mapOf("Content-Security-Policy" to UrlPolicy.CSP), java.io.ByteArrayInputStream(ByteArray(0)))
                }
                if (ResourceRoute.isResourceUrl(request.url.toString())) return resourceResponse(request)
                val response = assetLoader.shouldInterceptRequest(request.url) ?: return null
                response.responseHeaders = (response.responseHeaders ?: emptyMap()) + ("Content-Security-Policy" to UrlPolicy.CSP)
                return response
            }

            // The page holds the bridge: only the app's assets load here, a link tapped by the
            // user goes to the system browser, everything else is dropped.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                when (UrlPolicy.decide(request.url.toString())) {
                    UrlDecision.ALLOW -> return false
                    UrlDecision.EXTERNAL -> if (request.hasGesture()) openInBrowser(request.url)
                    UrlDecision.BLOCK -> Unit
                }
                return true
            }
        }

        if (activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            // Debug builds only: page errors reach logcat (no file content: console messages are the page's own).
            setWebContentsDebuggingEnabled(true)
            webChromeClient = object : android.webkit.WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    android.util.Log.d("NeoConsole", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }
        }

        check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            "WebView lacks DOCUMENT_START_SCRIPT"
        }
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "WebView lacks WEB_MESSAGE_LISTENER"
        }
        val origins = setOf(ORIGIN)
        // The shim must exist before any renderer script runs.
        val shim = activity.assets.open("web/neo-shim.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(this, shim, origins)
        WebViewCompat.addWebMessageListener(this, "neoAndroid", origins) { _, message, _, isMainFrame, replyProxy ->
            // A sub-frame (an iframe the page embeds) never reaches the bridge, and never steals the event sink.
            if (isMainFrame) onMessage(message, replyProxy)
        }
    }

    /** A quiz image: GET only, the perimeter and the type allow-list decide, 403 for everything else. */
    private fun resourceResponse(request: WebResourceRequest): WebResourceResponse {
        val served = if (request.method == "GET") app.resource(request.url.toString()) else null
        val headers = ResourceRoute.responseHeaders(served)
        if (served == null) return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", headers, java.io.ByteArrayInputStream(ByteArray(0)))
        return try {
            WebResourceResponse(served.mime, null, 200, "OK", headers, java.io.FileInputStream(served.file))
        } catch (_: java.io.IOException) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, java.io.ByteArrayInputStream(ByteArray(0)))
        }
    }

    private fun openInBrowser(uri: android.net.Uri) {
        try {
            activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri).addCategory(android.content.Intent.CATEGORY_BROWSABLE))
        } catch (_: android.content.ActivityNotFoundException) {
        }
    }

    private fun onMessage(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        // Never log the message: it carries file contents.
        val raw = message.data ?: return
        // Pushed events go to the page that spoke last (a reload gives a new proxy).
        bridge.sink = { reply.postMessage(it) }
        bridge.dispatch(raw) { reply.postMessage(it) }
    }

    override fun destroy() {
        app.shutdown()
        scope.cancel()
        super.destroy()
    }

    /** Asks the page to go back one step; `done(false)` when it has nowhere to go (called on the main thread). */
    fun askBack(done: (Boolean) -> Unit) {
        scope.launch {
            val handled = app.goBack()
            post { done(handled) }
        }
    }

    /** The predictive-back preview: shrinks the page and slides it away from the swiping edge (0 resets). */
    fun backPreview(progress: Float, edge: Int) {
        val p = progress.coerceIn(0f, 1f)
        val dir = if (edge == androidx.activity.BackEventCompat.EDGE_RIGHT) -1f else 1f
        scaleX = 1f - 0.08f * p
        scaleY = 1f - 0.08f * p
        translationX = dir * width * 0.03f * p
    }

    /** Pushes the file events of what changed on disk while the app was away. */
    fun rescan() = app.rescan()

    fun loadApp() {
        loadUrl("$ORIGIN/assets/web/index.html")
    }

    companion object {
        const val HOST = UrlPolicy.HOST
        const val ORIGIN = "https://$HOST"
    }
}
