package com.ahmedmili.neoquiz.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.TransitionDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.ahmedmili.neoquiz.R
import org.json.JSONObject

/**
 * The bottom tab bar, drawn natively under the WebView instead of inside the page.
 *
 * WHY: the Android 12 stretch overscroll is applied to the WHOLE WebView, so a bar fixed in the
 * page stretched with the content. Outside the WebView it stays still, like Neo Calendar's. The
 * page stays the source of truth (labels, icons, which tab is active, whether the bar shows at
 * all): it publishes its state on `android.barre` (`NavBarChannel`) and gets a tap back as the
 * index of the tab. Icons are Material Symbols Rounded vector drawables (outlined when inactive,
 * filled when active), picked by the tab's `id`; the tint is the page's active / muted colour.
 */
class NavBarView(context: Context) : LinearLayout(context) {
    /** Called on the main thread with the index of the tapped tab. */
    var onTap: (Int) -> Unit = {}

    private val line = View(context)
    private val row = LinearLayout(context)
    private var signature = ""
    /** Active state of each tab at the last render, to cross-fade only the tabs that changed. */
    private val wasActive = HashMap<String, Boolean>()

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
                val id = item.optString("id")
                val pair = ICONS[id]
                if (pair != null) {
                    // mutate(): each tab gets its OWN copy; drawables of a resource share their state, and an
                    // alpha set on one (the fade) showed on another (a filled icon on an inactive tab).
                    val outlined = resources.getDrawable(pair.first, context.theme).mutate()
                    val filled = resources.getDrawable(pair.second, context.theme).mutate()
                    val to = if (on) filled else outlined
                    // Fade only when the tab really changed state (<= 150 ms). A plain redraw sets the icon
                    // directly: a zero-length fade from a drawable to itself sometimes drew nothing.
                    val changed = wasActive[id] != null && wasActive[id] != on
                    if (changed) {
                        val fade = TransitionDrawable(arrayOf(if (on) outlined else filled, to)).apply { isCrossFadeEnabled = true }
                        setImageDrawable(fade)
                        fade.startTransition(FADE_MS)
                    } else {
                        setImageDrawable(to)
                    }
                    imageTintList = ColorStateList.valueOf(if (on) active else muted)
                }
                // The active tab glows softly: a faint radial light behind its icon (2026-10-05).
                background = if (on) GradientDrawable().apply {
                    gradientType = GradientDrawable.RADIAL_GRADIENT
                    gradientRadius = dp(16).toFloat()
                    colors = intArrayOf(0x40FFFFFF, 0x00FFFFFF)
                } else null
                wasActive[id] = on
            }
            tab.addView(icon, LayoutParams(dp(25), dp(25)))
            tab.addView(
                TextView(context).apply {
                    text = item.optString("label")
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                    typeface = Typeface.create(Typeface.DEFAULT, 600, false)
                    setTextColor(if (on) active else muted)
                    // Same soft light around the active label.
                    if (on) setShadowLayer(dp(8).toFloat(), 0f, 0f, 0x99FFFFFF.toInt())
                    maxLines = 1
                    setPadding(0, dp(1), 0, 0)
                },
                LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT),
            )
            row.addView(tab, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()

    companion object {
        private const val FADE_MS = 120

        /** Tab id (the page's `data-nav` key, or `settings`) to its (outlined, filled) drawables. */
        private val ICONS = mapOf(
            "home" to (R.drawable.ic_nav_home_outlined to R.drawable.ic_nav_home_filled),
            "quizzes" to (R.drawable.ic_nav_folder_outlined to R.drawable.ic_nav_folder_filled),
            "ai" to (R.drawable.ic_nav_generate_outlined to R.drawable.ic_nav_generate_filled),
            "settings" to (R.drawable.ic_nav_settings_outlined to R.drawable.ic_nav_settings_filled),
        )

        /** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` as the page's computed styles give them. */
        fun css(value: String, fallback: Int): Int {
            val n = Regex("[0-9.]+").findAll(value).map { it.value.toFloat() }.toList()
            if (n.size < 3) return fallback
            val alpha = if (n.size > 3) (n[3] * 255).toInt() else 255
            return Color.argb(alpha, n[0].toInt(), n[1].toInt(), n[2].toInt())
        }
    }
}
