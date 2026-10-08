package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/** Hands text (and files) to the system share sheet. false when nothing could be launched. */
fun interface PromptSender {
    suspend fun send(text: String, files: List<File>): Boolean
}

/** Reads the clipboard text, or null when empty. */
fun interface ClipboardSource {
    fun get(): String?
}

/**
 * `android.partagerPrompt` / `android.lirePressePapier`: the relay through an AI app. The page
 * gives a TEXT and document NAMES + BYTES, never a path; files are written by Kotlin under the
 * share-only cache folder the FileProvider exposes and nothing else. The clipboard is read ONLY
 * by the second call, which the page makes on an explicit tap (no polling, no background read,
 * the content is never logged).
 */
class RelayChannel(
    private val dir: File,
    private val sender: PromptSender,
    private val clipboard: ClipboardSink,
    private val source: ClipboardSource,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val last = AtomicLong(0)

    private fun name(raw: Any?): String {
        val s = raw as? String ?: throw IllegalArgumentException("nom refusé")
        val ok = s.isNotEmpty() && s.length <= 150 && s == s.trim() && !s.contains(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]")) &&
            !FileShare.isReservedName(s) && s.lowercase().let { it.endsWith(".md") || it.endsWith(".txt") } &&
            s.substringBeforeLast('.').isNotEmpty() && !s.startsWith(".")
        if (!ok) throw IllegalArgumentException("nom refusé")
        return s
    }

    private fun decode(raw: Any?): ByteArray {
        val b = raw as? String ?: throw IllegalArgumentException("contenu refusé")
        if (b.length > (MAX_FILE_BYTES / 3 + 1) * 4) throw IllegalArgumentException("fichier trop grand")
        val out = try {
            Base64.getDecoder().decode(b)
        } catch (_: IllegalArgumentException) {
            throw IllegalArgumentException("contenu refusé")
        }
        if (out.size > MAX_FILE_BYTES) throw IllegalArgumentException("fichier trop grand")
        return out
    }

    suspend fun share(text: Any?, files: Any?): Boolean {
        val t = text as? String
        if (t == null || t.isEmpty() || t.length > MAX_TEXT) throw IllegalArgumentException("texte refusé")
        val list = files as? JSONArray ?: throw IllegalArgumentException("fichiers refusés")
        if (list.length() > MAX_FILES) throw IllegalArgumentException("trop de fichiers")
        // Everything is validated and decoded BEFORE anything is written.
        val decoded = (0 until list.length()).map { i ->
            val o = list.opt(i) as? JSONObject ?: throw IllegalArgumentException("fichier refusé")
            name(o.opt("name")) to decode(o.opt("base64"))
        }
        if (decoded.sumOf { it.second.size.toLong() } > MAX_TOTAL_BYTES) throw IllegalArgumentException("fichiers trop gros")
        val ts = now()
        val before = last.get()
        if (before != 0L && ts - before < MIN_INTERVAL_MS || !last.compareAndSet(before, ts)) throw IllegalStateException(BUSY)
        var folder: File? = null
        var sent = false
        try {
            purge(ts)
            folder = File(dir, UUID.randomUUID().toString()).apply { mkdirs() }
            val used = HashSet<String>()
            val written = decoded.map { (n, bytes) ->
                var unique = n
                var k = 2
                while (!used.add(unique.lowercase())) {
                    unique = n.substringBeforeLast('.') + " ($k)." + n.substringAfterLast('.')
                    k++
                }
                File(folder, unique).also { it.writeBytes(bytes) }
            }
            // Some apps drop EXTRA_TEXT when files come with it: the prompt is on the clipboard too.
            clipboard.set(t)
            sent = sender.send(t, written)
            return sent
        } finally {
            // Released on every failed outcome: the user may retry at once, no half share stays in the cache.
            if (!sent) {
                folder?.deleteRecursively()
                last.compareAndSet(ts, before)
            }
        }
    }

    internal fun purge(t: Long) {
        dir.listFiles()?.forEach { f -> if (f.isDirectory && t - f.lastModified() > MAX_AGE_MS) f.deleteRecursively() }
    }

    /** Null when empty (Android 10+ also answers empty when the app has no focus); over the bound it refuses, never cuts. */
    fun readClipboard(): String? {
        val text = source.get() ?: return null
        if (text.length > MAX_CLIPBOARD) throw IllegalArgumentException("presse-papiers trop long")
        return text
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "android.partagerPrompt" to { a -> share(a.opt(0), a.opt(1)) },
        "android.lirePressePapier" to { _ -> readClipboard() },
    )

    companion object {
        const val MAX_TEXT = 200_000
        const val MAX_FILES = 10
        const val MAX_FILE_BYTES = 4 * 1024 * 1024
        const val MAX_TOTAL_BYTES = 16L * 1024 * 1024
        const val MAX_CLIPBOARD = 1_000_000
        const val MIN_INTERVAL_MS = 2_000L
        const val MAX_AGE_MS = 10 * 60 * 1000L
        const val BUSY = "partage-occupe"
    }
}
