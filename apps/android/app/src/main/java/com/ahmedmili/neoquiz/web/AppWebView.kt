package com.ahmedmili.neoquiz.web

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

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
class AppWebView(context: Context) : WebView(context) {

    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain(HOST)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
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

        check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            "WebView lacks DOCUMENT_START_SCRIPT"
        }
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "WebView lacks WEB_MESSAGE_LISTENER"
        }
        val origins = setOf(ORIGIN)
        // The shim must exist before any renderer script runs.
        val shim = context.assets.open("web/neo-shim.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(this, shim, origins)
        WebViewCompat.addWebMessageListener(this, "neoAndroid", origins) { _, message, _, _, replyProxy ->
            onMessage(message, replyProxy)
        }
    }

    private fun onMessage(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val raw = message.data ?: return
        Log.i(TAG, "bridge call: $raw")
        val id = try {
            JSONObject(raw).getLong("id")
        } catch (e: Exception) {
            Log.w(TAG, "unreadable bridge message", e)
            return
        }
        // Every channel is implemented by a later task.
        val answer = JSONObject().put("id", id).put("ok", false).put("erreur", "not-implemented")
        reply.postMessage(answer.toString())
    }

    fun loadApp() {
        loadUrl("$ORIGIN/assets/web/index.html")
    }

    companion object {
        private const val TAG = "NeoQuiz"
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
    }
}
