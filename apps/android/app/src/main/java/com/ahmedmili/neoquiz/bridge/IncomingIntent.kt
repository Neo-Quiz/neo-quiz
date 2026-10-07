package com.ahmedmili.neoquiz.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.IntentCompat
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The Android half of receiving a file ("Open with" = `ACTION_VIEW`, "Share to" = `ACTION_SEND`
 * with a stream): the URI is resolved HERE, never handed to the page. One file at a time, off the
 * main thread; the decision comes from [IncomingRules] and the copy is streamed, bounded, into the
 * cache's `incoming/` folder under a name of our own. Anything that is not ours (a pairing link, a
 * text share) is left alone.
 */
object IncomingIntent {
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "incoming-file").apply { isDaemon = true } }

    /** The URI of the file an intent offers, or null when it is something else (a pairing link, a review tap). */
    fun uriOf(intent: Intent?): Uri? = when (intent?.action) {
        Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        Intent.ACTION_VIEW -> intent.data?.takeIf { it.scheme.equals("content", true) || it.scheme.equals("file", true) }
        else -> null
    }

    fun handle(context: Context, intent: Intent?, inbox: IncomingInbox = IncomingInbox.shared) {
        val uri = uriOf(intent) ?: return
        val app = context.applicationContext
        worker.execute {
            val entry = try {
                resolve(app, uri)
            } catch (_: Exception) {
                IncomingInbox.Entry(null, null, IncomingRules.UNREADABLE)
            }
            inbox.raise(entry)
        }
    }

    private fun resolve(context: Context, uri: Uri): IncomingInbox.Entry {
        val resolver = context.contentResolver
        var name: String? = null
        var size: Long? = null
        if (uri.scheme.equals("content", true)) {
            try {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                        val s = c.getColumnIndex(OpenableColumns.SIZE)
                        if (s >= 0 && !c.isNull(s) && c.getLong(s) >= 0) size = c.getLong(s)
                    }
                }
            } catch (_: Exception) {
                // A provider without the columns: the name falls back to the URI's last segment below.
            }
        }
        val verdict = IncomingRules.decide(uri.scheme, uri.authority, context.packageName, name ?: uri.lastPathSegment, size)
        if (verdict is IncomingRules.Verdict.Reject) return IncomingInbox.Entry(null, null, verdict.reason)
        verdict as IncomingRules.Verdict.Accept
        // The system's answer, not the URI's spelling: whoever really serves this authority must not be us.
        val serving = try {
            context.packageManager.resolveContentProvider(uri.authority.orEmpty(), 0)?.packageName
        } catch (_: Exception) {
            null
        }
        if (IncomingRules.servedByUs(serving, context.packageName)) return IncomingInbox.Entry(null, null, IncomingRules.WRONG_TYPE)

        val dir = File(context.cacheDir, "incoming").apply { mkdirs() }
        purge(dir, System.currentTimeMillis())
        val copy = File(dir, "${UUID.randomUUID()}.${verdict.extension}")
        try {
            val input = resolver.openInputStream(uri) ?: return IncomingInbox.Entry(null, null, IncomingRules.UNREADABLE)
            val written = input.use { i -> FileOutputStream(copy).use { o -> IncomingRules.copyBounded(i, o) } }
            if (written == 0L) {
                copy.delete()
                return IncomingInbox.Entry(null, null, IncomingRules.UNREADABLE)
            }
        } catch (_: IncomingRules.TooLarge) {
            copy.delete()
            return IncomingInbox.Entry(null, null, IncomingRules.TOO_LARGE)
        } catch (_: Exception) {
            copy.delete()
            return IncomingInbox.Entry(null, null, IncomingRules.UNREADABLE)
        }
        return IncomingInbox.Entry(verdict.label, copy, null)
    }

    /** Removes the copies older than [IncomingRules.MAX_AGE_MS]. */
    internal fun purge(dir: File, now: Long) {
        dir.listFiles()?.forEach { f -> if (f.isFile && now - f.lastModified() > IncomingRules.MAX_AGE_MS) f.delete() }
    }
}
