package com.ahmedmili.neoquiz.bridge

import android.os.Handler
import android.os.Looper
import com.ahmedmili.neoquiz.ui.NavBarView
import org.json.JSONArray

/**
 * `android.barre`: the page publishes the state of its bottom tab bar (labels, active tab, icons,
 * visibility) and `NavBarView` draws it natively (see its comment for why). Phone only.
 */
class NavBarChannel(private val bar: NavBarView) {
    private val main = Handler(Looper.getMainLooper())

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.barre" to { a ->
            val state = a.optJSONObject(0) ?: throw IllegalArgumentException("barre: etat manquant")
            main.post { bar.apply(state) }
            null
        },
    )
}
