package com.ahmedmili.neoquiz.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/**
 * Debug-only hook (this file exists in the `debug` source set, never in a release): `seconds` arms the
 * review alarm that many seconds ahead; `due` first writes a table giving that count for today.
 */
class DebugReviewReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.hasExtra("due")) {
            val table = JSONArray().put(JSONObject().put("date", LocalDate.now().toString()).put("due", intent.getIntExtra("due", 0)))
            DueCalendar.of(context).save(table, DueCalendar.Texts("Daily review", "{count} question to review today", "{count} questions to review today"))
        }
        val seconds = intent.getIntExtra("seconds", 60)
        ReviewAlarm.scheduleAt(context, System.currentTimeMillis() + seconds * 1000L)
    }
}
