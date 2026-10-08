package com.ahmedmili.neoquiz.bridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The page learns of its OWN file writes through file events, as on the PC where
 * a live watcher (chokidar) reports them. Android has no watcher (a rescan runs
 * on return to the foreground and after Syncthing receives), so a quiz deleted
 * or moved on the phone stayed listed until the app came back (2026-10-08).
 * [onWrite] is the hook `FilesChannel` calls after every successful write, move
 * or removal: a path the catalogue can see is followed by ONE [rescan],
 * coalesced over [delayMs] so an import of many files costs a single walk. A
 * path under a dot folder (`.neo-quiz` journals, `.trash`, an import's staging
 * folder) is never in the catalogue and triggers nothing.
 */
class OwnWriteRescan(
    private val scope: CoroutineScope,
    private val rescan: suspend () -> Unit,
    private val delayMs: Long = 150,
) {
    private val lock = Any()
    private var job: Job? = null

    fun onWrite(path: String) {
        if (!ScanChannel.visibleToCatalogue(path)) return
        synchronized(lock) {
            job?.cancel()
            job = scope.launch {
                delay(delayMs)
                rescan()
            }
        }
    }
}
