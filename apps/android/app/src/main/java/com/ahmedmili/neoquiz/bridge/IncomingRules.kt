package com.ahmedmili.neoquiz.bridge

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale

/**
 * What the app accepts of a file ANOTHER app hands it ("Open with", "Share to"), as pure rules.
 * Nothing the sender announces is trusted: the type is only a hint that got the app listed, the
 * NAME must end in `.zip` or `.md` ([ChooserRules.acceptsName]), the size is bounded before AND
 * while reading, and the content is validated by the shared importer (`share-import.ts`) like a
 * file picked by hand. The name is never used as a path: the copy is named by us.
 */
object IncomingRules {
    /** The same bound as `IMPORT_LIMITS.archive` (`src/dashboard/zip.ts`): pinned by `check:android-pont`. */
    const val MAX_BYTES = 64L * 1024 * 1024

    /** A copy older than this is removed (taken or not): the cache must not keep a received file. */
    const val MAX_AGE_MS = 10 * 60 * 1000L

    /** Answers of `android.fichierRecu` when a received file was refused (`erreur`), read by the page. */
    const val TOO_LARGE = "trop-grand"
    const val WRONG_TYPE = "type"
    const val UNREADABLE = "illisible"

    sealed class Verdict {
        /** Copy it; [extension] is `zip` or `md`, [label] the sender's name made harmless. */
        data class Accept(val extension: String, val label: String) : Verdict()
        data class Reject(val reason: String) : Verdict()
    }

    /**
     * Decides from what is known BEFORE reading a byte. Only a `content:` URI of ANOTHER app is read:
     * `file:` would reach the app's own private files, and a URI of this very app's providers
     * (which need no grant for the app itself) would reach the shared storage.
     */
    fun decide(scheme: String?, authority: String?, ownPackage: String, displayName: String?, size: Long?): Verdict {
        if (scheme?.lowercase(Locale.ROOT) != "content") return Verdict.Reject(WRONG_TYPE)
        val host = authority?.lowercase(Locale.ROOT) ?: return Verdict.Reject(UNREADABLE)
        val own = ownPackage.lowercase(Locale.ROOT)
        if (host == own || host.startsWith("$own.")) return Verdict.Reject(WRONG_TYPE)
        if (!ChooserRules.acceptsName(displayName)) return Verdict.Reject(WRONG_TYPE)
        if (size != null && size > MAX_BYTES) return Verdict.Reject(TOO_LARGE)
        val label = label(displayName!!)
        return Verdict.Accept(label.substringAfterLast('.').lowercase(Locale.ROOT), label)
    }

    /** The last component of [raw] without separators or characters Windows forbids, at most 150 long, extension kept. */
    fun label(raw: String): String {
        val last = raw.substringAfterLast('/').substringAfterLast('\\')
        val clean = last.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "-").trim().trim('.').trim()
        if (clean.length <= 150) return clean
        val ext = clean.substringAfterLast('.')
        return clean.take(150 - ext.length - 1).trimEnd('.', ' ') + "." + ext
    }

    class TooLarge : IOException("received file over the bound")

    /** Copies [input] to [out] and returns the byte count; throws [TooLarge] the moment more than [limit] bytes arrive. */
    fun copyBounded(input: InputStream, out: OutputStream, limit: Long = MAX_BYTES): Long {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) return total
            total += n
            if (total > limit) throw TooLarge()
            out.write(buffer, 0, n)
        }
    }
}
