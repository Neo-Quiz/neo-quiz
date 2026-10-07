package com.ahmedmili.neoquiz.code

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebMessagePortCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/** What the bridge asks of the sandbox (a fake in tests). */
interface CodeEngine {
    suspend fun run(job: Any?): JSONObject
    fun warm(language: String)

    /** `{installe, version, octets}` of a language pack (`"c"` or `"python"`). */
    fun packState(name: String): Map<String, Any?>

    /** Downloads and installs a pack; `"ok"`, `"reseau"` or `"empreinte"`. `progress` gets (received, total) bytes. */
    suspend fun installPack(name: String, progress: (Long, Long) -> Unit): String

    /** Deletes ONE pack (after any install of it that is running). */
    suspend fun deletePack(name: String)
}

/**
 * Runs the quizzes' code in a HIDDEN, isolated WebView: the Android twin of
 * `apps/windows/electron/code-sandbox.ts` (read its header for WHY: from
 * Python, `Function` is reachable and a SHARED quiz carries code the app runs).
 * The same two layers, each measured on the PC:
 *  1. the CSP on every response of the code origin, without `unsafe-eval`;
 *  2. a WebView apart from the app's: its own origin (`code.appassets...`),
 *     every request outside it answered 403 (`CodeProtocol.assetPathFor`), no
 *     file access, no network loads, no `addJavascriptInterface` and no
 *     message LISTENER. The only way in or out is ONE `WebMessagePort`, which
 *     `web/code-shim.js` (injected in this origin only) turns into `window.neoCode`.
 *
 * One job at a time (a mutex, a bounded queue); a fresh worker per run is
 * `page.js`'s own job. Storage of the origin is wiped after every run.
 */
@SuppressLint("SetJavaScriptEnabled")
class CodeSandbox(context: Context, private val scope: CoroutineScope) : CodeEngine {
    private val app = context.applicationContext
    private val debuggable = app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    private val mutex = Mutex()
    private val queued = AtomicInteger(0)
    private val ids = AtomicInteger(1)
    private val results = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private val loaded = ConcurrentHashMap<Int, CompletableDeferred<Unit>>()

    // Main thread only.
    private var view: WebView? = null
    private var port: WebMessagePortCompat? = null
    private var ready = CompletableDeferred<Boolean>()
    private var idle: Job? = null

    private val shim: String by lazy { app.assets.open("code-shim.js").bufferedReader().use { it.readText() } }
    /** The downloaded packs live in the app's private storage, never in the APK. */
    private val languages = File(app.filesDir, "languages")
    private val packLocks = ConcurrentHashMap<String, Mutex>()
    private fun lockOf(name: String) = packLocks.getOrPut(name) { Mutex() }

    private fun enginePresent(language: String): Boolean {
        val pack = LanguagePacks.packFor(language) ?: return false
        return LanguagePacks.installedVersion(languages, pack) != null
    }

    override fun packState(name: String): Map<String, Any?> = LanguagePacks.state(languages, name)

    override suspend fun installPack(name: String, progress: (Long, Long) -> Unit): String {
        if (name !in LanguagePacks.PINS) return "reseau"
        // One install per pack at a time; a second caller waits, then finds it in place.
        return lockOf(name).withLock {
            if (LanguagePacks.inPlace(languages, name)) "ok" else LanguagePacks.install(languages, name, LanguagePacks::openHttps, progress)
        }
    }

    override suspend fun deletePack(name: String) {
        if (name !in LanguagePacks.PINS) return
        lockOf(name).withLock { LanguagePacks.delete(languages, name) }
    }

    override suspend fun run(job: Any?): JSONObject {
        val j = CodeProtocol.parseJob(job) ?: return CodeProtocol.result("unavailable", error = "job refused")
        if (!enginePresent(j.language)) return CodeProtocol.result("not-installed")
        if (queued.get() >= CodeProtocol.QUEUE_LIMIT) return CodeProtocol.result("unavailable", error = "queue full")
        queued.incrementAndGet()
        try {
            return mutex.withLock {
                val r = execute(j)
                // Nothing survives from one run to the next (IndexedDB, local storage of the origin).
                withContext(Dispatchers.Main) { WebStorage.getInstance().deleteOrigin(CodeProtocol.ORIGIN) }
                r
            }
        } finally {
            queued.decrementAndGet()
        }
    }

    override fun warm(language: String) {
        if (!enginePresent(language)) return
        scope.launch {
            if (openAndAwaitReady()) withContext(Dispatchers.Main) { send(JSONObject().put("type", "chauffe").put("language", language)) }
        }
    }

    private suspend fun execute(j: CodeProtocol.Job): JSONObject {
        if (!openAndAwaitReady()) return CodeProtocol.result("unavailable")
        val id = ids.getAndIncrement()
        val done = CompletableDeferred<JSONObject>()
        val pret = CompletableDeferred<Unit>()
        results[id] = done
        loaded[id] = pret
        try {
            withContext(Dispatchers.Main) {
                send(
                    JSONObject().put("type", "travail").put("id", id).put("language", j.language).put("code", j.code)
                        .put("stdin", j.stdin).put("after", j.after ?: "").put("timeoutMs", j.timeoutMs),
                )
            }
            var out: JSONObject? = null
            // Loading has its own wide budget; the trial's budget only starts at the page's "ready" signal.
            val got = withTimeoutOrNull(CodeProtocol.LOADING_MS + CodeProtocol.FALLBACK_MS) {
                select<Unit> {
                    done.onAwait { out = it }
                    pret.onAwait { }
                }
            }
            if (got != null && out == null) out = withTimeoutOrNull(j.timeoutMs + CodeProtocol.FALLBACK_MS) { done.await() }
            val answer = out
            if (answer == null) {
                // The page never answered: reload it (the worker dies with it), re-warm for the next run.
                reload(j.language)
                return CodeProtocol.result("timeout")
            }
            return answer
        } finally {
            results.remove(id)
            loaded.remove(id)
        }
    }

    /** True once the page is loaded and the port handed over. */
    private suspend fun openAndAwaitReady(): Boolean {
        val wait = withContext(Dispatchers.Main) {
            rearmIdle()
            if (view == null) open()
            ready
        }
        return withTimeoutOrNull(CodeProtocol.LOADING_MS) { wait.await() } == true
    }

    private fun open() {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { "WebView lacks DOCUMENT_START_SCRIPT" }
        check(WebViewFeature.isFeatureSupported(WebViewFeature.CREATE_WEB_MESSAGE_CHANNEL)) { "WebView lacks CREATE_WEB_MESSAGE_CHANNEL" }
        val wv = WebView(app)
        wv.settings.apply {
            javaScriptEnabled = true
            // No storage API at all for the quiz's code, no file or content access, no network load.
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse = serve(request.url.toString())

            // The page never navigates anywhere; the first load (loadUrl) does not pass here.
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = true

            override fun onPageFinished(v: WebView, url: String?) {
                if (url == CodeProtocol.PAGE_URL && v === view) handOverPort(v)
            }

            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (v === view) close()
                return true
            }
        }
        if (debuggable) {
            wv.webChromeClient = object : android.webkit.WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    Log.d("NeoCode", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }
        }
        // The shim exists before any page script runs, in THIS origin only.
        WebViewCompat.addDocumentStartJavaScript(wv, shim, setOf(CodeProtocol.ORIGIN))
        view = wv
        ready = CompletableDeferred()
        wv.loadUrl(CodeProtocol.PAGE_URL)
    }

    private fun serve(url: String): WebResourceResponse {
        val path = CodeProtocol.assetPathFor(url) ?: return failure(403, "Forbidden")
        if (path.startsWith("code/languages/")) return servePack(path.removePrefix("code/languages/"))
        return try {
            WebResourceResponse(CodeProtocol.mimeFor(path), null, 200, "OK", CodeProtocol.headers(), app.assets.open(path))
        } catch (_: java.io.IOException) {
            failure(404, "Not Found")
        }
    }

    /** `<pack>/<file>` from the downloaded pack directory, never outside it (`assetPathFor` already refused any odd segment). */
    private fun servePack(rel: String): WebResourceResponse {
        val name = rel.substringBefore('/')
        if (name !in LanguagePacks.PINS) return failure(404, "Not Found")
        val root = languages.canonicalFile
        val file = try {
            File(root, rel).canonicalFile
        } catch (_: java.io.IOException) {
            return failure(404, "Not Found")
        }
        if (!file.path.startsWith(root.path + File.separator) || !file.isFile) return failure(404, "Not Found")
        return try {
            WebResourceResponse(CodeProtocol.mimeFor(file.name), null, 200, "OK", CodeProtocol.headers(), file.inputStream())
        } catch (_: java.io.IOException) {
            failure(404, "Not Found")
        }
    }

    private fun failure(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, CodeProtocol.headers(), ByteArrayInputStream(ByteArray(0)))

    private fun handOverPort(v: WebView) {
        port?.close()
        val channel = WebViewCompat.createWebMessageChannel(v)
        channel[0].setWebMessageCallback(object : WebMessagePortCompat.WebMessageCallbackCompat() {
            override fun onMessage(port: WebMessagePortCompat, message: WebMessageCompat?) {
                onPageMessage(message?.data ?: return)
            }
        })
        WebViewCompat.postWebMessage(v, WebMessageCompat("neo-code-port", arrayOf(channel[1])), Uri.parse(CodeProtocol.ORIGIN))
        port = channel[0]
        ready.complete(true)
    }

    private fun onPageMessage(raw: String) {
        val m = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return
        }
        val id = m.optInt("id", -1)
        when (m.optString("type")) {
            "pret" -> loaded[id]?.complete(Unit)
            "resultat" -> results.remove(id)?.complete(CodeProtocol.normalise(m.opt("res")))
        }
    }

    private fun send(message: JSONObject) {
        port?.postMessage(WebMessageCompat(message.toString()))
    }

    private suspend fun reload(language: String) {
        withContext(Dispatchers.Main) {
            port?.close()
            port = null
            ready = CompletableDeferred()
            view?.loadUrl(CodeProtocol.PAGE_URL)
        }
        // The rebuilt page has no pre-warmed worker any more.
        warm(language)
    }

    private fun rearmIdle() {
        idle?.cancel()
        idle = scope.launch {
            delay(CodeProtocol.IDLE_MS)
            withContext(Dispatchers.Main) { close() }
        }
    }

    /** The activity goes away: the hidden WebView goes with it. */
    fun shutdown() {
        android.os.Handler(android.os.Looper.getMainLooper()).post { close() }
    }

    /** Main thread. Destroys the WebView; every run still waiting answers `unavailable`. */
    private fun close() {
        idle?.cancel()
        port?.close()
        port = null
        view?.destroy()
        view = null
        ready.complete(false)
        ready = CompletableDeferred()
        for ((id, d) in results) {
            results.remove(id)
            d.complete(CodeProtocol.result("unavailable"))
        }
    }
}
