package com.ahmedmili.neoquiz.notify

import org.json.JSONArray
import org.json.JSONObject

/**
 * The rules of the "your quiz is ready" notification. Pure: no Android type, so
 * a JVM test judges them. Reads ONE chat file written by another device (strict
 * schema, same as the page's `readChats`), picks the finished requests this
 * phone sent, and decides what is new. Everything read is untrusted data.
 */
object ChatNotifyRules {
    const val MAX_FILE_BYTES = 2_000_000L
    const val MAX_NOTIFIED = 200
    const val MAX_TITLE = 100
    const val MAX_ERROR = 120
    /** Bounds on what one file may make us examine. */
    const val MAX_CHATS = 200
    const val MAX_REQUESTS = 400
    private const val INTERNAL = ".neo-quiz"

    enum class Kind { QUIZ, TEXT, FAILED }
    data class Pending(val key: String, val kind: Kind, val title: String, val path: String?, val extra: Int)

    private val DRIVE = Regex("^[A-Za-z]:")
    private val CONTROL = Regex("[\u0000-\u001f\u007f-\u009f\u2028\u2029]")
    // Bidi controls/isolates, zero-width, BOM: removed ("a<ZWSP>b" reads "ab").
    private val INVISIBLE = Regex("[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]")
    private val SPACES = Regex("\\s+")

    fun isCleanRelativePath(p: String): Boolean {
        if (p.isEmpty() || p.length > 500 || p.contains('\\') || p.contains('\u0000') || p.startsWith("/") || DRIVE.containsMatchIn(p)) return false
        val parts = p.split("/")
        if (parts.any { it.isEmpty() || it == "." || it == ".." }) return false
        return parts[0] != INTERNAL
    }

    fun readable(fileName: String, ownId: String): Boolean =
        fileName.endsWith(".json") && fileName != "$ownId.json" && !fileName.contains(".sync-conflict-")

    /** Plain text, cut to [max] code points. */
    private fun clean(s: String, max: Int): String {
        val t = s.replace(INVISIBLE, "").replace(CONTROL, " ").replace(SPACES, " ").trim()
        return if (t.codePointCount(0, t.length) <= max) t else t.substring(0, t.offsetByCodePoints(0, max))
    }

    private fun str(o: JSONObject, k: String): String? = (o.opt(k) as? String)
    private fun num(o: JSONObject, k: String): Boolean = o.opt(k) is Number

    fun parse(text: String, ownId: String): List<Pending> {
        if (text.length > MAX_FILE_BYTES) return emptyList()
        return try {
            val root = JSONObject(text)
            if ((root.opt("v") as? Int) != 1) return emptyList()
            val chats = root.optJSONArray("chats") ?: return emptyList()
            val out = mutableListOf<Pending>()
            var examined = 0
            for (i in 0 until minOf(chats.length(), MAX_CHATS)) {
                val chat = chats.optJSONObject(i) ?: continue
                if (str(chat, "id") == null || str(chat, "origin") == null || !num(chat, "createdAt") || !num(chat, "updatedAt")) continue
                val requests = chat.optJSONArray("requests") ?: continue
                for (j in 0 until requests.length()) {
                    if (examined++ >= MAX_REQUESTS) return out
                    pendingOf(requests.optJSONObject(j), ownId)?.let { out.add(it) }
                }
            }
            out
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun pendingOf(q: JSONObject?, ownId: String): Pending? {
        if (q == null) return null
        val id = str(q, "id") ?: return null
        val from = str(q, "from") ?: return null
        if (id.isEmpty() || id.length > 200 || !from.equals(ownId, ignoreCase = true)) return null
        if (!num(q, "at") || str(q, "text") == null) return null
        val mode = str(q, "mode")
        if (mode != "learn" && mode != "practice") return null
        if (q.opt("documents") !is JSONArray) return null
        val results = q.opt("results") as? JSONArray ?: return null
        val cards = (0 until results.length()).mapNotNull { k ->
            val r = results.optJSONObject(k) ?: return@mapNotNull null
            when (str(r, "kind")) {
                "quiz" -> if (str(r, "title") != null && str(r, "path") != null) r else null
                "text" -> if (str(r, "text") != null) r else null
                else -> null
            }
        }
        return when (str(q, "state")) {
            "failed" -> Pending(id, Kind.FAILED, clean((str(q, "error") ?: "").lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: "", MAX_ERROR), null, 0)
            "done" -> {
                val quizzes = cards.filter { str(it, "kind") == "quiz" }
                val first = quizzes.firstOrNull()
                when {
                    first != null -> {
                        val path = str(first, "path")!!.takeIf { isCleanRelativePath(it) }
                        Pending(id, Kind.QUIZ, clean(str(first, "title")!!, MAX_TITLE), path, quizzes.size - 1)
                    }
                    cards.isNotEmpty() -> Pending(id, Kind.TEXT, "", null, 0)
                    else -> null
                }
            }
            else -> null
        }
    }

    fun select(found: List<Pending>, notified: List<String>): Pair<List<Pending>, List<String>> {
        val seen = notified.toMutableList()
        val fresh = mutableListOf<Pending>()
        for (p in found) {
            if (p.key in seen) continue
            seen.add(p.key)
            fresh.add(p)
        }
        return fresh to seen.takeLast(MAX_NOTIFIED)
    }
}
