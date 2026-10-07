package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray

/** Hands a file to the system share sheet; false when nothing could be launched. */
fun interface ShareSender {
    suspend fun send(file: File, mime: String): Boolean
}

/**
 * The rules of a share, mirror of `nomPartage` / `octetsPartage` in
 * `apps/windows/electron/partage.ts`: the page gives a NAME and BYTES, never a
 * path. A name is a name (no separator, no character Windows forbids), the
 * extension is one of two, the bytes are bounded.
 */
object FileShare {
    /** The same bound as `SHARE_MAX_BYTES` (`src/dashboard/zip.ts`) and `TAILLE_MAX_PARTAGE`. */
    const val MAX_BYTES = 16 * 1024 * 1024
    private val EXTENSIONS = mapOf("zip" to "application/zip", "md" to "text/markdown")
    private val FORBIDDEN = Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]")

    /** Windows device names (reserved for every extension): COPY of `RESERVED` in `src/dashboard/share-names.ts`, pinned by `check:android-pont`. */
    private val RESERVED = Regex("^(con|prn|aux|nul|conin\\$|conout\\$|com[0-9¹²³]|lpt[0-9¹²³])$", RegexOption.IGNORE_CASE)

    /** Is the name a Windows device name for any extension (`con.txt.md` as much as `CON.md`)? */
    internal fun isReservedName(name: String): Boolean =
        RESERVED.matches(java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFC).substringBefore('.').trimEnd())

    /** The sanitised file name, or null when it is not a share. */
    fun name(raw: Any?): String? {
        if (raw !is String) return null
        val clean = raw.replace(FORBIDDEN, "-").replace(Regex("^[\\s.]+|[\\s.]+$"), "").trim()
        if (clean.isEmpty() || clean.length > 150) return null
        if (isReservedName(clean)) return null
        val dot = clean.lastIndexOf('.')
        if (dot <= 0) return null
        return if (clean.substring(dot + 1).lowercase() in EXTENSIONS) clean else null
    }

    fun mime(name: String): String = EXTENSIONS.getValue(name.substringAfterLast('.').lowercase())

    /** The decoded bytes, or null when empty, malformed or over the bound (checked BEFORE decoding). */
    fun bytes(base64: Any?): ByteArray? {
        if (base64 !is String || base64.isEmpty()) return null
        if (base64.length > (MAX_BYTES / 3 + 1) * 4) return null
        val out = try {
            Base64.getDecoder().decode(base64)
        } catch (_: IllegalArgumentException) {
            return null
        }
        return if (out.isNotEmpty() && out.size <= MAX_BYTES) out else null
    }
}

/**
 * `partage.enregistrer` on Android: the file goes to the system SHARE SHEET (the
 * phone has no "save as" dialog, and the sheet offers Files, Drive, Discord,
 * mail...). It is written under [dir] (a folder of the app's cache that the
 * FileProvider exposes and nothing else), in a fresh sub-folder per share, and
 * older ones are removed. One share at a time, and two seconds at least between
 * two (a page cannot stack share sheets).
 */
class ShareChannel(
    private val dir: File,
    private val sender: ShareSender,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val last = AtomicLong(0)

    /** The shared file name, or null when the share sheet could not open. Throws on a refused name or content. */
    suspend fun enregistrer(name: Any?, base64: Any?): String? {
        val clean = FileShare.name(name)
        val bytes = FileShare.bytes(base64)
        if (clean == null || bytes == null) throw IllegalArgumentException("partage refusé : nom ou contenu invalide")
        val t = now()
        val before = last.get()
        if (before != 0L && t - before < MIN_INTERVAL_MS || !last.compareAndSet(before, t)) throw IllegalStateException(BUSY)
        var folder: File? = null
        var sent = false
        try {
            purge(t)
            folder = File(dir, UUID.randomUUID().toString()).apply { mkdirs() }
            val file = File(folder, clean)
            file.writeBytes(bytes)
            sent = sender.send(file, FileShare.mime(clean))
            return if (sent) clean else null
        } finally {
            // The guard is ALWAYS released when the share did not reach the sheet (failure, no app to
            // receive it): the user may try again at once, and no half share stays in the cache.
            if (!sent) {
                folder?.deleteRecursively()
                last.compareAndSet(t, before)
            }
        }
    }

    /** Removes the shares older than [MAX_AGE_MS]; failures are silent (a purge must not stop a share). */
    internal fun purge(t: Long) {
        dir.listFiles()?.forEach { f ->
            if (f.isDirectory && t - f.lastModified() > MAX_AGE_MS) f.deleteRecursively()
        }
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "partage.enregistrer" to { a -> enregistrer(a.opt(0), a.opt(1)) },
    )

    companion object {
        /** Read by the page (`PARTAGE_OCCUPE`, `electron/pont.ts`). */
        const val BUSY = "partage-occupe"
        const val MIN_INTERVAL_MS = 2_000L
        const val MAX_AGE_MS = 10 * 60 * 1000L
    }
}
