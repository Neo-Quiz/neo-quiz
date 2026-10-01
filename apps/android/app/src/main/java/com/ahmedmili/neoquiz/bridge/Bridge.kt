package com.ahmedmili.neoquiz.bridge

import java.util.concurrent.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Kotlin end of `window.neo` (wire format in `AppWebView.kt` and
 * `web/shim.ts`). One call = one coroutine: a handler's value becomes
 * `{"id","ok":true,"valeur"}`, its exception `{"id","ok":false,"erreur":message}`.
 * A channel nobody handles answers an error, never silence: a call that is
 * never answered would hang its caller forever.
 */
class Bridge(private val scope: CoroutineScope, private val handlers: Map<String, suspend (JSONArray) -> Any?>) {
    /** Where pushed events go (the reply proxy of the current page); set by the WebView host. */
    @Volatile var sink: ((String) -> Unit)? = null

    fun dispatch(json: String, reply: (String) -> Unit) {
        val msg = try {
            JSONObject(json)
        } catch (_: Exception) {
            return
        }
        val id = msg.optLong("id", -1)
        if (id < 0) return
        val canal = msg.optString("canal")
        val handler = handlers[canal]
        if (handler == null) {
            reply(failure(id, "unknown-channel: $canal"))
            return
        }
        val args = msg.optJSONArray("args") ?: JSONArray()
        scope.launch {
            val answer = try {
                success(id, handler(args))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                failure(id, e.message ?: e.javaClass.simpleName)
            }
            reply(answer)
        }
    }

    /** Pushes an event to the page: `{"evenement","donnees"}`. */
    fun emit(evenement: String, donnees: Any?) {
        sink?.invoke(JSONObject().put("evenement", evenement).put("donnees", toJson(donnees)).toString())
    }

    private fun success(id: Long, value: Any?) = JSONObject().put("id", id).put("ok", true).put("valeur", toJson(value)).toString()

    private fun failure(id: Long, message: String) = JSONObject().put("id", id).put("ok", false).put("erreur", message).toString()
}

/** Converts a handler result to something `JSONObject.put` serialises faithfully (`Unit` and `null` are JSON null). */
internal fun toJson(value: Any?): Any = when (value) {
    null, Unit -> JSONObject.NULL
    is JSONObject, is JSONArray, is String, is Boolean, is Number -> value
    is Map<*, *> -> JSONObject().also { o -> value.forEach { (k, v) -> o.put(k.toString(), toJson(v)) } }
    is Iterable<*> -> JSONArray().also { a -> value.forEach { a.put(toJson(it)) } }
    else -> value.toString()
}

/** A path argument: a non-blank string, anything else is refused like the Electron perimeter does. */
internal fun JSONArray.path(i: Int): String {
    val v = opt(i)
    if (v !is String || v.isBlank()) throw IllegalArgumentException("chemin invalide : ${if (v == null) "undefined" else JSONObject.quote(v.toString())}")
    return v
}

/** A text argument (`String(contenu)` on the Electron side). */
internal fun JSONArray.text(i: Int): String = opt(i).let { if (it == null || it == JSONObject.NULL) "null" else it.toString() }

internal fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { opt(it) as? String }
