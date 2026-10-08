package com.ahmedmili.neoquiz.bridge

import org.json.JSONArray

/**
 * `android.format24h`: whether the phone's own system clock is set to 24-hour. The page asks at start
 * and each time the app returns to the foreground, so flipping the system toggle is picked up.
 */
class HourFormatChannel(private val is24Hour: () -> Boolean) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.format24h" to { _ -> is24Hour() },
    )
}
