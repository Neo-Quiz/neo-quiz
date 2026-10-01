package com.ahmedmili.neoquiz.sync

import android.util.Log

/**
 * Logging of the sync code. An exception message can carry a device id or a
 * path (REST errors, I/O errors), so a release build logs the exception CLASS
 * only; the message appears in debuggable builds (set by [SyncHub]).
 */
object SyncLog {
    @Volatile var verbose = false

    fun warn(tag: String, what: String, e: Throwable) {
        Log.w(tag, "$what: ${if (verbose) e.message ?: e.javaClass.simpleName else e.javaClass.simpleName}")
    }
}
