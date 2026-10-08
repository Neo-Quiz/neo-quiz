package com.ahmedmili.neoquiz.bridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import org.json.JSONArray

/** Puts text on the clipboard. */
fun interface ClipboardSink {
    fun set(text: String)
}

class AndroidClipboard(private val context: Context) : ClipboardSink {
    override fun set(text: String) {
        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Neo Quiz", text))
    }
}

/**
 * `systeme.copierTexte`, mirror of the Electron handler: text only (`String(texte)`
 * on the Windows side), through the system clipboard. Bounded, so a page cannot hand
 * the clipboard service megabytes.
 */
class ClipboardChannel(private val sink: ClipboardSink) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "systeme.copierTexte" to { a ->
            val text = a.text(0)
            if (text.length > MAX_CHARS) throw IllegalArgumentException("texte trop long pour le presse-papiers")
            sink.set(text)
            null
        },
    )

    private companion object {
        const val MAX_CHARS = 1_000_000
    }
}

/**
 * Text of the primary clip. Only ever called from the `android.lirePressePapier` handler (an explicit
 * tap on the page); Android 10+ answers null when the app has no focus, which reads as empty.
 */
class AndroidClipboardSource(private val context: Context) : ClipboardSource {
    override fun get(): String? =
        context.getSystemService(ClipboardManager::class.java).primaryClip
            ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
}
