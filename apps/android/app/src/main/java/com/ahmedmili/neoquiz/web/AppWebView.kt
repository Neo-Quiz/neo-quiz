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
import com.ahmedmili.neoquiz.bridge.createAppBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

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

        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
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
        WebViewCompat.addWebMessageListener(this, "neoAndroid", origins) { _, message, _, _, replyProxy ->
            onMessage(message, replyProxy)
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
        scope.cancel()
        super.destroy()
    }

    /** Pushes the file events of what changed on disk while the app was away. */
    fun rescan() = app.rescan()

    fun loadApp() {
        loadUrl("$ORIGIN/assets/web/index.html")
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
    }
}
