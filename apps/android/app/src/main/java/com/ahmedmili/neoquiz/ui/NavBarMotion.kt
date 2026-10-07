package com.ahmedmili.neoquiz.ui

import kotlin.math.roundToInt

/**
 * The pure part of the bottom tab bar's motion (no Android classes, so it runs in a JVM test).
 *
 * The active-tab pill copies Flutter's `NavigationIndicator` (Thunder, `navigation_bar.dart`):
 * a 500 ms linear controller `t`, a horizontal-only scale `0.4 + 0.6 * E(t)` where `E` is the
 * `easeInOutCubicEmphasized` curve, and an opacity that fades in (or out) over the first 100 ms.
 */
internal object NavBarMotion {
    /** Duration of the pill's full travel (t from 0 to 1), in ms. */
    const val PILL_MS = 500L

    /** The curve of Flutter's `Curves.easeInOutCubicEmphasized`, as the two cubic segments of its Path. */
    private val EMPHASIZED = arrayOf(
        // Each segment: x0, y0, x1, y1, x2, y2, x3, y3 (the control points, as moveTo / cubicTo give them).
        doubleArrayOf(0.0, 0.0, 0.05, 0.0, 0.133333, 0.06, 0.166666, 0.4),
        doubleArrayOf(0.166666, 0.4, 0.208333, 0.82, 0.25, 1.0, 1.0, 1.0),
    )

    /** `E(t)`: the emphasized curve at linear progress [t] (clamped to 0..1). */
    fun emphasized(t: Float): Float {
        val x = t.coerceIn(0f, 1f).toDouble()
        val seg = EMPHASIZED.first { x <= it[6] }
        // The x of each segment rises with its parameter, so bisection finds the parameter for `x`.
        var lo = 0.0
        var hi = 1.0
        repeat(60) {
            val mid = (lo + hi) / 2
            if (bezier(seg[0], seg[2], seg[4], seg[6], mid) < x) lo = mid else hi = mid
        }
        return bezier(seg[1], seg[3], seg[5], seg[7], (lo + hi) / 2).toFloat()
    }

    private fun bezier(p0: Double, p1: Double, p2: Double, p3: Double, s: Double): Double {
        val u = 1 - s
        return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3
    }

    /** Horizontal scale of the pill at progress [t]: it jumps to 0.4 as soon as it starts, then grows to 1. */
    fun indicatorScaleX(t: Float): Float = 0.4f + 0.6f * emphasized(t)

    /**
     * Opacity of the pill at progress [t]. Selecting: 0 to 1 over the first 100 ms (t runs 0 to 1).
     * Deselecting: t runs 1 to 0, and the opacity falls from 1 to 0 over the first 100 ms of that run.
     */
    fun indicatorAlpha(t: Float, selected: Boolean): Float {
        val shown = if (selected) t * (PILL_MS / 100f) else t * (PILL_MS / 100f) - (PILL_MS / 100f - 1f)
        return shown.coerceIn(0f, 1f)
    }

    /** Per-channel linear mix of two ARGB colours; [f] = 0 gives [from], 1 gives [to]. */
    fun mix(from: Int, to: Int, f: Float): Int {
        val k = f.coerceIn(0f, 1f)
        fun channel(shift: Int): Int {
            val a = (from ushr shift) and 0xFF
            val b = (to ushr shift) and 0xFF
            return (a + (b - a) * k).roundToInt()
        }
        return (channel(24) shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
    }

    /**
     * The active tabs after a tap on tab [index], shown before the page answers: the tapped tab
     * becomes the only active one. Null when nothing moves: a placeholder tab, an index out of
     * range, or the tab that is already active.
     */
    fun activeAfterTap(active: List<Boolean>, placeholder: List<Boolean>, index: Int): List<Boolean>? {
        if (index !in active.indices || placeholder.getOrElse(index) { true } || active[index]) return null
        return active.indices.map { it == index }
    }

    /** [color] with its alpha replaced by [alpha] (0..1). */
    fun withAlpha(color: Int, alpha: Float): Int =
        ((alpha.coerceIn(0f, 1f) * 255).roundToInt() shl 24) or (color and 0x00FFFFFF)
}
