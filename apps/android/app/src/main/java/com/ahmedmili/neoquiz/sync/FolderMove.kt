package com.ahmedmili.neoquiz.sync

import android.util.Log
import java.io.File

/**
 * The synced folder lives at the ROOT of the shared storage, `/storage/emulated/0/Neo Quiz`, like
 * Neo Calendar's (owner's decision, 2026-10-04). Until then it was `Documents/Neo Quiz`: [move]
 * MOVES it there once, a rename on the same storage (instant, nothing copied, nothing lost: the
 * quizzes, `.neo-quiz/` with this phone's review history, Syncthing's `.stfolder`).
 *
 * Run before anything reads the folder (the bridge at start, the sync service before Syncthing),
 * idempotent, and it never merges: when both folders hold something, the old one stays where it is
 * and [blocked] keeps sync from starting, so Syncthing never sees a folder that lost its files
 * (it would send those deletions to the PC).
 */
object FolderMove {
    private const val TAG = "FolderMove"

    /** The folder of the versions before 2026-10-04. */
    fun legacyRoot(documents: File): File = File(documents, "Neo Quiz")

    @Synchronized
    fun move(legacy: File, target: File) {
        if (!legacy.isDirectory) return
        val targetEmpty = !target.exists() || (target.isDirectory && target.list()?.isEmpty() == true)
        if (!targetEmpty) {
            Log.w(TAG, "both the old and the new folder hold files: the old one is left in place")
            return
        }
        if (target.isDirectory && !target.delete()) {
            Log.w(TAG, "the empty new folder cannot be replaced")
            return
        }
        if (!legacy.renameTo(target)) Log.w(TAG, "the old folder cannot be moved to the root")
    }

    /** True while the old folder still holds files: the move did not happen, sync must not start. */
    fun blocked(legacy: File): Boolean = legacy.isDirectory && legacy.list()?.isNotEmpty() == true

    /** [path] moved from [from] to [to] when it is [from] or under it, else unchanged. */
    fun movedPath(path: String, from: String, to: String): String = when {
        path == from -> to
        path.startsWith("$from/") -> to + path.substring(from.length)
        else -> path
    }
}
