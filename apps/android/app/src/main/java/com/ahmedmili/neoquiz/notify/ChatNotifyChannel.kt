package com.ahmedmili.neoquiz.notify

import org.json.JSONArray
import org.json.JSONObject

/**
 * `android.suivreChats` / `android.quizDemande`. The page tells Kotlin who this phone
 * is and the texts of the notification (the page knows the app language; no JavaScript
 * runs in the background); Kotlin keeps them in private storage and ChatNotifier reads
 * them. Nothing here takes a path, a URL or a package name from the page.
 */
class ChatNotifyChannel(private val store: Store) {
    interface Store {
        fun get(key: String): String?
        fun put(key: String, value: String?)
    }

    data class Texts(val quizReady: String, val quizReadyMore: String, val textReady: String, val failed: String, val channel: String) {
        fun render(p: ChatNotifyRules.Pending): String = when (p.kind) {
            ChatNotifyRules.Kind.QUIZ -> (if (p.extra > 0) quizReadyMore else quizReady).replace("{title}", p.title).replace("{extra}", p.extra.toString())
            ChatNotifyRules.Kind.TEXT -> textReady
            ChatNotifyRules.Kind.FAILED -> failed.replace("{error}", p.title)
        }

        fun toJson(): String = JSONObject().put("quizReady", quizReady).put("quizReadyMore", quizReadyMore).put("textReady", textReady).put("failed", failed).put("channel", channel).toString()

        companion object {
            /** Used when the page never pushed its strings. */
            val DEFAULT = Texts("Quiz ready: {title}", "Quiz ready: {title} (+{extra})", "Answer ready", "Generation failed: {error}", "Chats")

            fun of(raw: Any?): Texts {
                val o = raw as? JSONObject ?: throw IllegalArgumentException("texts refused")
                fun s(k: String): String = (o.opt(k) as? String)?.takeIf { it.length <= 120 } ?: throw IllegalArgumentException("text $k refused")
                return Texts(s("quizReady"), s("quizReadyMore"), s("textReady"), s("failed"), s("channel"))
            }
            fun parse(json: String?): Texts? = try { json?.let { of(JSONObject(it)) } } catch (_: Exception) { null }
        }
    }

    fun openQuiz(path: String) {
        if (ChatNotifyRules.isCleanRelativePath(path)) store.put(KEY_OPEN, path)
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.suivreChats" to { a ->
            val id = a.opt(0) as? String
            if (id == null || !DEVICE.matches(id)) throw IllegalArgumentException("device id refused")
            val texts = Texts.of(a.opt(1))
            store.put(KEY_DEVICE, id)
            store.put(KEY_TEXTS, texts.toJson())
            null
        },
        "android.quizDemande" to { _ ->
            val path = store.get(KEY_OPEN)
            store.put(KEY_OPEN, null)
            path
        },
    )

    companion object {
        const val KEY_DEVICE = "chatNotifyDevice"
        const val KEY_TEXTS = "chatNotifyTexts"
        const val KEY_OPEN = "chatNotifyOpen"
        const val KEY_NOTIFIED = "chatNotified"
        private val DEVICE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

        /** Cuts to [max] code points. */
        fun cut(s: String, max: Int): String =
            if (s.codePointCount(0, s.length) <= max) s else s.substring(0, s.offsetByCodePoints(0, max))
    }
}
