package com.ahmedmili.neoquiz.bridge

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import org.json.JSONArray

/**
 * `android.barre`: the page publishes the state of its bottom tab bar (labels, active tab, icons,
 * visibility, colours) and `NavBarView` draws it natively (see its comment for why). Phone only.
 */
class NavBarChannel(private val apply: (JSONObject) -> Unit, private val tick: () -> Unit = {}) {
    private val main by lazy { Handler(Looper.getMainLooper()) }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.barre" to { a ->
            val state = a.optJSONObject(0) ?: throw IllegalArgumentException("barre: state missing")
            main.post { apply(state) }
            null
        },
        /* A short tick when a swipe changes page: the page asks, the view performs it. */
        "android.haptique" to { _ ->
            main.post { tick() }
            null
        },
    )
}
