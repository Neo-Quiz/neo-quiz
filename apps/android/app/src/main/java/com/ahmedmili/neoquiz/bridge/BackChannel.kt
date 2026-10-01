package com.ahmedmili.neoquiz.bridge

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray

/**
 * The Back key, asked of the renderer instead of answered here: the page has its
 * own navigation history (screens, folders, modals), so Kotlin pushes
 * `android.retour` and waits for the verdict, which the page sends on
 * `android.retourTraite` (true = it went back one step). No answer in time, or
 * false, means there is nothing to go back to and the activity leaves.
 */
class BackChannel(private val ask: () -> Unit) {
    @Volatile private var waiting: CompletableDeferred<Boolean>? = null

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.retourTraite" to { a ->
            waiting?.complete(a.optBoolean(0, false))
            null
        },
    )

    /** True when the page handled the key. A second press while one is pending is swallowed. */
    suspend fun request(timeoutMs: Long = TIMEOUT_MS): Boolean {
        if (waiting != null) return true
        val verdict = CompletableDeferred<Boolean>()
        waiting = verdict
        try {
            ask()
            return withTimeoutOrNull(timeoutMs) { verdict.await() } ?: false
        } finally {
            waiting = null
        }
    }

    companion object {
        const val TIMEOUT_MS = 600L
    }
}
