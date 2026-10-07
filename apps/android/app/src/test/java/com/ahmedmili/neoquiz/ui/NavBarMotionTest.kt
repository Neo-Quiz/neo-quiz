package com.ahmedmili.neoquiz.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NavBarMotionTest {
    @Test fun pillStartsAt40PercentWidthAndEndsAtFull() {
        // The pill jumps to 0.4 as soon as it starts (E(0) = 0) and reaches the full width at the end.
        assertEquals(0.4f, NavBarMotion.indicatorScaleX(0.000001f), 0.001f)
        assertEquals(1f, NavBarMotion.indicatorScaleX(1f), 0.0001f)
        assertTrue(NavBarMotion.indicatorScaleX(0.5f) > 0.95f)
    }

    @Test fun pillFadesInOver100msOfA500msTravel() {
        // Selecting: t runs 0 to 1 over 500 ms, so 100 ms is t = 0.2, where the opacity is full.
        assertEquals(1f, NavBarMotion.indicatorAlpha(0.2f, selected = true), 0.0001f)
        assertEquals(0.5f, NavBarMotion.indicatorAlpha(0.1f, selected = true), 0.0001f)
        assertEquals(0f, NavBarMotion.indicatorAlpha(0f, selected = true), 0.0001f)
    }

    @Test fun pillFadesOutOver100msWhileTravellingBack() {
        // Deselecting: t runs 1 to 0; the first 100 ms (t from 1 to 0.8) fade it from 1 to 0.
        assertEquals(1f, NavBarMotion.indicatorAlpha(1f, selected = false), 0.0001f)
        assertEquals(0.5f, NavBarMotion.indicatorAlpha(0.9f, selected = false), 0.0001f)
        assertEquals(0f, NavBarMotion.indicatorAlpha(0.8f, selected = false), 0.0001f)
        assertEquals(0f, NavBarMotion.indicatorAlpha(0f, selected = false), 0.0001f)
    }

    @Test fun mixTakesEachChannelLinearly() {
        val mixed = NavBarMotion.mix(0xFF000000.toInt(), 0xFFFFFFFF.toInt(), 0.5f)
        assertEquals(0x80, (mixed ushr 16) and 0xFF)
        assertEquals(0x80, (mixed ushr 8) and 0xFF)
        assertEquals(0xFF, mixed ushr 24)
        assertEquals(0xFF000000.toInt(), NavBarMotion.mix(0xFF000000.toInt(), 0xFFFFFFFF.toInt(), 0f))
    }

    @Test fun withAlphaKeepsTheColour() {
        val c = NavBarMotion.withAlpha(0xFF112233.toInt(), 0.1f)
        assertEquals(26, c ushr 24)
        assertEquals(0x112233, c and 0xFFFFFF)
    }

    @Test fun tapMovesTheActiveTabAtOnce() {
        // Home active, Folders tapped: Folders alone is active, before the page has answered.
        val none = listOf(false, false, false, false)
        assertEquals(listOf(false, true, false, false), NavBarMotion.activeAfterTap(listOf(true, false, false, false), none, 1))
    }

    @Test fun placeholderTapNeverMovesThePill() {
        // Generate is a placeholder: the tap is handed to the page, the pill stays where it is.
        val placeholder = listOf(false, false, true, false)
        assertEquals(null, NavBarMotion.activeAfterTap(listOf(true, false, false, false), placeholder, 2))
    }

    @Test fun tapOnTheActiveTabOrOutOfRangeChangesNothing() {
        val none = listOf(false, false, false)
        assertEquals(null, NavBarMotion.activeAfterTap(listOf(false, true, false), none, 1))
        assertEquals(null, NavBarMotion.activeAfterTap(listOf(false, true, false), none, 3))
        assertEquals(null, NavBarMotion.activeAfterTap(listOf(false, true, false), none, -1))
    }
}
