package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.util.Base64

/**
 * "Another app handed us a file": the activity's resolver ([IncomingIntent]) copies it into the
 * cache and raises it here; the page reads it ONCE (`android.fichierRecu`), which also deletes the
 * copy. Holds one entry: a newer file replaces (and deletes) the older one. Like the pairing link,
 * the page may ask at startup (a file that launched the app) or on the pushed event (one that
 * arrived while it runs).
 */
class IncomingInbox {
    /** Either a copied file ([file]) or the reason it was refused ([error], one of `IncomingRules.*`). */
    class Entry(val name: String?, val file: File?, val error: String?)

    private var pending: Entry? = null

    /** Set by the bridge: tells a page that is already open to read. */
    @Volatile var listener: (() -> Unit)? = null

    fun raise(entry: Entry) {
        synchronized(this) {
            pending?.file?.delete()
            pending = entry
        }
        listener?.invoke()
    }

    private fun take(): Entry? = synchronized(this) { pending.also { pending = null } }

    /** The entry as the page gets it: `{nom, octets}` (base64), `{erreur}` or null. The copy is deleted either way. */
    fun takeForPage(): Map<String, Any?>? {
        val e = take() ?: return null
        e.error?.let { return mapOf("erreur" to it) }
        val file = e.file ?: return mapOf("erreur" to IncomingRules.UNREADABLE)
        return try {
            mapOf("nom" to e.name, "octets" to Base64.getEncoder().encodeToString(file.readBytes()))
        } catch (_: Exception) {
            mapOf("erreur" to IncomingRules.UNREADABLE)
        } finally {
            file.delete()
        }
    }

    companion object {
        val shared = IncomingInbox()
    }
}
