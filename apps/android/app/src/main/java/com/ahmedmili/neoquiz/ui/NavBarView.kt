package com.ahmedmili.neoquiz.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.RippleDrawable
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * The bottom tab bar, drawn natively under the WebView instead of inside the page.
 *
 * WHY: the Android 12 stretch overscroll is applied to the WHOLE WebView, so a bar fixed in the
 * page stretched with the content. Outside the WebView it stays still, like Neo Calendar's. The
 * page stays the source of truth (labels, icons, which tab is active, whether the bar shows at
 * all): it publishes its state on `android.barre` (`NavBarChannel`) and gets a tap back as the
 * index of the tab. Icons arrive as PNGs the page rasterised from its own SVGs, in both states.
 */
class NavBarView(context: Context) : LinearLayout(context) {
    /** Called on the main thread with the index of the tapped tab. */
    var onTap: (Int) -> Unit = {}

    private val line = View(context)
    private val row = LinearLayout(context)
    private var signature = ""
    private val icons = HashMap<String, Bitmap>()

    init {
        orientation = VERTICAL
        visibility = GONE
        addView(line, LayoutParams(LayoutParams.MATCH_PARENT, 1))
        row.orientation = HORIZONTAL
        row.setPadding(dp(20), 0, dp(20), 0)
        addView(row, LayoutParams(LayoutParams.MATCH_PARENT, dp(56)))
    }

    /** Applies the page's state (main thread). Cheap when nothing changed. */
    fun apply(state: JSONObject) {
        if (!state.optBoolean("visible", false)) {
            visibility = GONE
            return
        }
        val sig = state.toString()
        visibility = VISIBLE
        if (sig == signature) return
        signature = sig
        setBackgroundColor(css(state.optString("bg"), Color.BLACK))
        line.setBackgroundColor(css(state.optString("line"), Color.DKGRAY))
        val muted = css(state.optString("muted"), Color.GRAY)
        val active = css(state.optString("active"), Color.WHITE)
        row.removeAllViews()
        val items = state.optJSONArray("items") ?: return
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            val on = item.optBoolean("active")
            val tab = LinearLayout(context).apply {
                orientation = VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(0, dp(6), 0, 0)
                foreground = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), null, ColorDrawable(Color.WHITE))
                isClickable = true
                contentDescription = item.optString("label")
                if (!item.optBoolean("placeholder")) setOnClickListener { onTap(i) }
            }
            val icon = ImageView(context).apply {
                bitmap(item.optString(if (on) "on" else "off"))?.let(::setImageBitmap)
            }
            tab.addView(icon, LayoutParams(dp(25), dp(25)))
            tab.addView(
                TextView(context).apply {
                    text = item.optString("label")
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                    typeface = Typeface.create(Typeface.DEFAULT, 600, false)
                    setTextColor(if (on) active else muted)
                    maxLines = 1
                    setPadding(0, dp(1), 0, 0)
                },
                LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT),
            )
            row.addView(tab, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
        }
    }

    private fun bitmap(dataUrl: String): Bitmap? {
        if (!dataUrl.startsWith(PNG_PREFIX)) return null
        return icons.getOrPut(dataUrl) {
            val bytes = Base64.decode(dataUrl.substring(PNG_PREFIX.length), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()

    companion object {
        private const val PNG_PREFIX = "data:image/png;base64,"

        /** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` as the page's computed styles give them. */
        fun css(value: String, fallback: Int): Int {
            val n = Regex("[0-9.]+").findAll(value).map { it.value.toFloat() }.toList()
            if (n.size < 3) return fallback
            val alpha = if (n.size > 3) (n[3] * 255).toInt() else 255
            return Color.argb(alpha, n[0].toInt(), n[1].toInt(), n[2].toInt())
        }
    }
}
