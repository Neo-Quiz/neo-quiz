package com.ahmedmili.neoquiz.notify

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The next days' due counts, precomputed by the page (the scheduler is JavaScript: no JavaScript ever
 * runs in the background) and stored here for the daily alarm to READ. Kotlin never computes a schedule:
 * a day that is not in the table, or a table that cannot be read, answers `null` and nothing is notified.
 *
 * Stored as one JSON object `{"days":{"YYYY-MM-DD":n},"texts":{title,bodyOne,bodyOther}}`.
 */
class DueCalendar(private val storage: Storage) {
    interface Storage {
        fun read(): String?
        fun write(raw: String)
    }

    /** The notification strings, taken from the renderer's dictionaries (the app language). `{count}` is replaced. */
    class Texts(val title: String, private val bodyOne: String, private val bodyOther: String) {
        fun body(count: Int): String = (if (count == 1) bodyOne else bodyOther).replace("{count}", count.toString())
        internal fun toJson() = JSONObject().put("title", title).put("bodyOne", bodyOne).put("bodyOther", bodyOther)
    }

    /** Replaces the table. A malformed entry refuses the WHOLE table (the previous one stays). */
    fun save(table: JSONArray, texts: Texts) {
        val days = JSONObject()
        for (i in 0 until table.length()) {
            val entry = table.optJSONObject(i) ?: throw IllegalArgumentException("entry $i is not an object")
            val date = entry.optString("date", "")
            require(DATE.matches(date)) { "entry $i: bad date" }
            val due = entry.opt("due")
            require(due is Int && due >= 0) { "entry $i: bad count" }
            days.put(date, due)
        }
        storage.write(JSONObject().put("days", days).put("texts", texts.toJson()).toString())
    }

    /** The number of questions due on a local day (`YYYY-MM-DD`), or `null` when unknown or unreadable. */
    fun dueOn(date: String): Int? {
        val days = root()?.optJSONObject("days") ?: return null
        val value = days.opt(date)
        return (value as? Int)?.takeIf { it >= 0 }
    }

    fun texts(): Texts? {
        val t = root()?.optJSONObject("texts") ?: return null
        val title = t.opt("title") as? String ?: return null
        val one = t.opt("bodyOne") as? String ?: return null
        val other = t.opt("bodyOther") as? String ?: return null
        return Texts(title, one, other)
    }

    private fun root(): JSONObject? = try {
        storage.read()?.let { JSONObject(it) }
    } catch (_: org.json.JSONException) {
        null
    }

    companion object {
        private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")

        fun of(context: Context) = DueCalendar(object : Storage {
            private val prefs = context.applicationContext.getSharedPreferences("due_calendar", Context.MODE_PRIVATE)
            override fun read() = prefs.getString("table", null)
            override fun write(raw: String) = prefs.edit().putString("table", raw).apply()
        })
    }
}
