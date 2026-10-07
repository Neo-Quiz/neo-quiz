package com.ahmedmili.neoquiz.ui

import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.View
import android.view.animation.AnimationUtils
import android.view.animation.LinearInterpolator
import android.widget.LinearLayout
import com.ahmedmili.neoquiz.R
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The bottom tab bar, drawn natively under the WebView instead of inside the page.
 *
 * WHY: the Android 12 stretch overscroll is applied to the WHOLE WebView, so a bar fixed in the
 * page stretched with the content. Outside the WebView it stays still, like Neo Calendar's. The
 * page stays the source of truth (labels, icons, which tab is active, whether the bar shows at
 * all, its colours): it publishes its state on `android.barre` (`NavBarChannel`) and gets a tap
 * back as the index of the tab.
 *
 * Measures copied from Mihon's bottom bar (Material 3 NavigationBar), read on a phone at density 3
 * (1 dp = 3 px), portrait:
 * - bar 80 dp high, no separator line, tabs of equal width over the whole width (no side margin);
 * - pill (indicator) 56 x 32 dp, corner radius 16 dp, its top 10 dp below the top of the bar, centred
 *   in its tab; the icon (24 dp) is centred in it, so the icon centre sits 26 dp from the top;
 * - label 14 sp, weight 500, letter spacing 0.1 sp, one line, ellipsized at the end, always shown; its
 *   glyphs run from about 50 dp to 63 dp from the top (baseline 60.4 dp);
 * - pill colour = the text colour at 11 % over the bar; the inactive icon and label use the page's
 *   normal text colour; the active icon uses the app's accent, the active label its accent text colour;
 * - the press feedback is a ripple clipped to the pill shape, the text colour at 10 % (Material 3).
 *
 * Pill animation copied from Thunder (Flutter NavigationBar, `NavigationIndicator`): see `NavBarMotion`.
 * Icon animation copied from Mihon's AnimatedVectorDrawable: the outline is drawn, and the filled
 * drawable is revealed by a circle growing from the icon centre over 300 ms with the platform's
 * `fast_out_slow_in`, and closing again on deselection. The colour of the icon and of the label
 * changes over 100 ms, linearly.
 *
 * Icons are the PC rail's Lucide icons as vector drawables (outline when inactive, the rail's
 * filled shape when active), picked by the tab's `id`.
 */
class NavBarView(context: Context) : LinearLayout(context) {
    /** Called on the main thread with the index of the tapped tab (a placeholder tab too: the page answers). */
    var onTap: (Int) -> Unit = {}

    private val row = LinearLayout(context)
    /** The page's colours as last applied, for the optimistic change on a tap. */
    private var shown: NavColors? = null
    private var signature = ""
    /** The ids, labels and placeholder flags of the tabs as they were built. */
    private var tabsKey = ""
    private val tabs = ArrayList<NavTab>()
    private val fastOutSlowIn: TimeInterpolator by lazy {
        AnimationUtils.loadInterpolator(context, android.R.interpolator.fast_out_slow_in)
    }

    init {
        orientation = VERTICAL
        visibility = GONE
        row.orientation = HORIZONTAL
        addView(row, LayoutParams(LayoutParams.MATCH_PARENT, dp(BAR_HEIGHT)))
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
        val colors = NavColors.from(state)
        shown = colors
        setBackgroundColor(colors.bg)
        val items = state.optJSONArray("items")
        if (items == null) {
            tabs.clear()
            row.removeAllViews()
            tabsKey = ""
            return
        }
        val key = StringBuilder()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            key.append(item.optString("id")).append('\u0001')
                .append(item.optString("label")).append('\u0001')
                .append(item.optBoolean("placeholder")).append('\u0002')
        }
        // Same tabs as before: only their state changes, and that change animates. A first display
        // or a changed list is set in place without animation.
        val sameTabs = key.toString() == tabsKey && tabs.size == items.length()
        if (!sameTabs) {
            row.removeAllViews()
            tabs.clear()
            tabsKey = key.toString()
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val tab = NavTab(
                    context,
                    item.optString("id"),
                    item.optString("label"),
                    placeholder = item.optBoolean("placeholder"),
                    on = item.optBoolean("active"),
                )
                tab.setOnClickListener { tapped(i) }
                tabs.add(tab)
                row.addView(tab, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
            }
        }
        for (i in tabs.indices) {
            tabs[i].update(colors, items.getJSONObject(i).optBoolean("active"), animate = sameTabs)
        }
    }

    /**
     * A tap: the pill and the colours move to the tapped tab at once, without waiting for the page.
     * The signature is cleared so that the page's answer is applied even when it equals the last
     * state it sent: a refused move brings the old tab back. A placeholder tab changes nothing here.
     */
    private fun tapped(index: Int) {
        val colors = shown
        val next = NavBarMotion.activeAfterTap(tabs.map { it.isOn }, tabs.map { it.placeholder }, index)
        if (colors != null && next != null) {
            signature = ""
            for (i in tabs.indices) tabs[i].update(colors, next[i], animate = true)
        }
        onTap(index)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()

    private fun dpF(v: Float) = v * resources.displayMetrics.density

    /** One tab: draws its pill, icon and label itself, so each animation is a plain value it can read. */
    private inner class NavTab(
        context: Context,
        private val id: String,
        private val label: String,
        /** A tab the phone does not serve yet: it takes taps (ripple, and the page answers) but never moves the pill. */
        val placeholder: Boolean,
        on: Boolean,
    ) : View(context) {
        private var selected = on
        /** Whether the tab is the active one, as shown (optimistic changes included). */
        val isOn: Boolean get() = selected
        private var colors = NavColors(Color.BLACK, Color.WHITE, Color.WHITE, Color.WHITE)
        /** Pill progress t: 0 hidden, 1 fully travelled. Starts at its resting value. */
        private var pillT = if (on) 1f else 0f
        /** Reveal of the filled icon: 0 outline only, 1 filled only. */
        private var reveal = pillT
        /** Colour progress: 0 inactive colours, 1 active colours. */
        private var colorT = pillT
        private val anims = HashMap<String, ValueAnimator>()

        private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(Typeface.DEFAULT, 500, false)
            textAlign = Paint.Align.CENTER
            textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, LABEL_SP, resources.displayMetrics)
            // letterSpacing is in em: 0.1 sp over a 14 sp label.
            letterSpacing = LETTER_SPACING_SP / LABEL_SP
        }
        // Each tab gets its OWN copy: drawables of a resource share their state, so a tint or an alpha
        // set on one tab showed on another (a filled icon on an inactive tab).
        private val pair = ICONS[id]
        private val outline: Drawable? = pair?.let { resources.getDrawable(it.first, context.theme).mutate() }
        private val filled: Drawable? = pair?.let { resources.getDrawable(it.second, context.theme).mutate() }
        private val sameIcon = pair != null && pair.first == pair.second
        private val clipPath = Path()

        init {
            contentDescription = label
            isClickable = true
            isSelected = on
        }

        /** Sets the tab's colours and state; a change of state animates when [animate] is set. */
        fun update(colors: NavColors, on: Boolean, animate: Boolean) {
            this.colors = colors
            isSelected = on
            if (on != selected) {
                selected = on
                val target = if (on) 1f else 0f
                if (animate) {
                    tween("pill", pillT, target, NavBarMotion.PILL_MS, LinearInterpolator()) { pillT = it }
                    tween("reveal", reveal, target, REVEAL_MS, fastOutSlowIn) { reveal = it }
                    tween("color", colorT, target, COLOR_MS, LinearInterpolator()) { colorT = it }
                } else {
                    anims.values.forEach { it.cancel() }
                    anims.clear()
                    pillT = target
                    reveal = target
                    colorT = target
                }
            }
            refreshRipple()
            invalidate()
        }

        /** Runs one value from [from] to [to]; [ms] is the time of a full 0 to 1 travel, so a part-way change takes its share. */
        private fun tween(key: String, from: Float, to: Float, ms: Long, interpolator: TimeInterpolator, set: (Float) -> Unit) {
            anims.remove(key)?.cancel()
            if (from == to) return
            anims[key] = ValueAnimator.ofFloat(from, to).apply {
                duration = max(1L, (ms * abs(to - from)).toLong())
                this.interpolator = interpolator
                addUpdateListener {
                    set(it.animatedValue as Float)
                    invalidate()
                }
                start()
            }
        }

        override fun onSizeChanged(w: Int, h: Int, oldW: Int, oldH: Int) {
            super.onSizeChanged(w, h, oldW, oldH)
            refreshRipple()
        }

        /** The press ripple, clipped to the pill's shape (56 x 32 dp, centred, top 10 dp). */
        private fun refreshRipple() {
            if (width == 0) {
                foreground = null
                return
            }
            val insetX = ((width - dpF(PILL_W)) / 2f).roundToInt()
            val insetTop = dpF(PILL_TOP).roundToInt()
            val insetBottom = (height - dpF(PILL_TOP + PILL_H)).roundToInt()
            val shape = GradientDrawable().apply {
                setShape(GradientDrawable.RECTANGLE)
                cornerRadius = dpF(PILL_RADIUS)
                setColor(Color.WHITE)
            }
            val mask = InsetDrawable(shape, insetX, insetTop, insetX, insetBottom)
            val ripple = ColorStateList.valueOf(NavBarMotion.withAlpha(colors.texte, RIPPLE_ALPHA))
            foreground = RippleDrawable(ripple, null, mask)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            drawPill(canvas, cx)
            drawIcon(canvas, cx)
            drawLabel(canvas, cx)
        }

        private fun drawPill(canvas: Canvas, cx: Float) {
            if (pillT <= 0f) return
            val alpha = NavBarMotion.indicatorAlpha(pillT, selected)
            if (alpha <= 0f) return
            val half = dpF(PILL_W) / 2f * NavBarMotion.indicatorScaleX(pillT)
            pillPaint.color = NavBarMotion.mix(colors.bg, colors.texte, PILL_MIX)
            pillPaint.alpha = (alpha * 255).roundToInt()
            val top = dpF(PILL_TOP)
            canvas.drawRoundRect(cx - half, top, cx + half, top + dpF(PILL_H), min(dpF(PILL_RADIUS), half), min(dpF(PILL_RADIUS), half), pillPaint)
        }

        private fun drawIcon(canvas: Canvas, cx: Float) {
            val out = outline ?: return
            val fill = filled ?: return
            val iconColor = NavBarMotion.mix(colors.texte, colors.accent, colorT)
            val half = dpF(ICON_PX / 2f)
            val centreY = dpF(ICON_TOP + ICON_PX / 2f)
            val left = (cx - half).roundToInt()
            val top = dpF(ICON_TOP).roundToInt()
            val right = (cx + half).roundToInt()
            val bottom = dpF(ICON_TOP + ICON_PX).roundToInt()
            if (sameIcon || reveal >= 1f) {
                drawIconDrawable(canvas, fill, left, top, right, bottom, iconColor)
                return
            }
            drawIconDrawable(canvas, out, left, top, right, bottom, iconColor)
            if (reveal > 0f) {
                // The filled shape, shown inside a circle from the icon centre that reaches the corners.
                val save = canvas.save()
                clipPath.reset()
                clipPath.addCircle(cx, centreY, hypot(half, half) * reveal, Path.Direction.CW)
                canvas.clipPath(clipPath)
                drawIconDrawable(canvas, fill, left, top, right, bottom, iconColor)
                canvas.restoreToCount(save)
            }
        }

        private fun drawIconDrawable(canvas: Canvas, d: Drawable, l: Int, t: Int, r: Int, b: Int, color: Int) {
            d.setBounds(l, t, r, b)
            d.setTint(color)
            d.draw(canvas)
        }

        private fun drawLabel(canvas: Canvas, cx: Float) {
            labelPaint.color = NavBarMotion.mix(colors.texte, colors.accentTexte, colorT)
            val fitted = TextUtils.ellipsize(label, labelPaint, width - dpF(8f), TextUtils.TruncateAt.END).toString()
            canvas.drawText(fitted, cx, dpF(LABEL_BASELINE), labelPaint)
        }
    }

    /** The page's colours of the bar, as its computed styles give them. */
    internal data class NavColors(val bg: Int, val texte: Int, val accent: Int, val accentTexte: Int) {
        companion object {
            /** Pages that do not send the newer keys fall back to the older ones (`muted`, `active`). */
            fun from(state: JSONObject): NavColors {
                val muted = css(state.optString("muted"), Color.GRAY)
                val active = css(state.optString("active"), Color.WHITE)
                return NavColors(
                    bg = css(state.optString("bg"), Color.BLACK),
                    texte = css(state.optString("texte"), muted),
                    accent = css(state.optString("accent"), active),
                    accentTexte = css(state.optString("accentTexte"), active),
                )
            }
        }
    }

    companion object {
        private const val BAR_HEIGHT = 80
        private const val PILL_W = 56f
        private const val PILL_H = 32f
        private const val PILL_TOP = 10f
        private const val PILL_RADIUS = 16f
        /** Share of the text colour mixed over the bar for the pill (Mihon: 11 %). */
        private const val PILL_MIX = 0.11f
        private const val ICON_PX = 24f
        private const val ICON_TOP = 14f
        /** Baseline of the label: its glyphs run from about 50 dp to 63 dp (ascender top to descender bottom). */
        private const val LABEL_BASELINE = 60.4f
        private const val LABEL_SP = 14f
        private const val LETTER_SPACING_SP = 0.1f
        private const val REVEAL_MS = 300L
        private const val COLOR_MS = 100L
        /** The press ripple: the text colour at 10 % (Material 3). */
        private const val RIPPLE_ALPHA = 0.10f

        /** Tab id (the page's `data-nav` key, or `settings`) to its (outlined, filled) drawables. */
        private val ICONS = mapOf(
            "home" to (R.drawable.ic_nav_home to R.drawable.ic_nav_home_filled),
            "quizzes" to (R.drawable.ic_nav_folders to R.drawable.ic_nav_folders_filled),
            "ai" to (R.drawable.ic_nav_sparkles to R.drawable.ic_nav_sparkles_filled),
            // The rail does not fill Settings: same drawable both ways.
            "settings" to (R.drawable.ic_nav_settings to R.drawable.ic_nav_settings),
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
