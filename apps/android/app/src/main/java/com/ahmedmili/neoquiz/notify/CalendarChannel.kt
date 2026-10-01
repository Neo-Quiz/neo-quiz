package com.ahmedmili.neoquiz.notify

import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/** "The user tapped the daily review notification": raised by the activity, taken once by the page. */
object ReviewOpenRequest {
    private val flag = AtomicBoolean(false)
    fun raise() = flag.set(true)
    fun take(): Boolean = flag.getAndSet(false)
}

/**
 * The Android-only `android` group of the bridge (not part of the Windows `Pont`):
 *  - `android.calendrier(table, texts)`: the page saves the due counts of the next days and the
 *    notification strings of its language; the alarm is re-armed. Malformed: refused, nothing stored.
 *  - `android.revisionDemandee()`: true once after a tap on the notification (the page then lands on Home,
 *    where today's review is).
 */
class CalendarChannel(private val calendar: DueCalendar, private val onSaved: () -> Unit) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.calendrier" to { a ->
            val table = a.optJSONArray(0) ?: throw IllegalArgumentException("table missing")
            val t = a.optJSONObject(1) ?: throw IllegalArgumentException("texts missing")
            calendar.save(table, texts(t))
            onSaved()
            null
        },
        "android.revisionDemandee" to { _ -> ReviewOpenRequest.take() },
    )

    private fun texts(t: JSONObject): DueCalendar.Texts {
        fun field(name: String) = (t.opt(name) as? String)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("texts.$name missing")
        return DueCalendar.Texts(field("title"), field("bodyOne"), field("bodyOther"))
    }
}
