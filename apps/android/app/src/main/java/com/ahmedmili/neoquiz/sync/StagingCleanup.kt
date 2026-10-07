package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files

/**
 * Removes the STAGING folders an interrupted import left behind (`<parent>/.import-<12 hex>`,
 * written by `share-import.ts`). Syncthing ignores them (`.import-*` in [ShareRules.IGNORES]), so
 * nothing else would ever clean them. Only a folder whose name is EXACTLY that shape and that is
 * older than [MAX_AGE_MS] is removed (an import in progress is minutes old at most), links are never
 * followed, and the walk is bounded.
 */
object StagingCleanup {
    const val MAX_AGE_MS = 60 * 60 * 1000L
    private const val MAX_ENTRIES = 50_000
    private val NAME = Regex("^\\.import-[0-9a-f]{12}$")

    /** Returns how many staging folders were removed. Failures are silent: a cleanup must not stop the sync. */
    fun purge(root: File, now: Long): Int {
        var removed = 0
        var seen = 0
        val pending = ArrayDeque<File>()
        pending.add(root)
        while (pending.isNotEmpty() && seen < MAX_ENTRIES) {
            val dir = pending.removeFirst()
            val children = try { dir.listFiles() } catch (_: Exception) { null } ?: continue
            for (child in children) {
                if (++seen > MAX_ENTRIES) break
                if (!child.isDirectory || Files.isSymbolicLink(child.toPath())) continue
                if (NAME.matches(child.name)) {
                    if (now - child.lastModified() > MAX_AGE_MS && deleteTree(child)) removed++
                } else if (child.name != ".stfolder" && child.name != ".trash") {
                    pending.add(child)
                }
            }
        }
        return removed
    }

    /** Deletes [dir] and what it holds without ever following a link (a link is removed, not entered). */
    private fun deleteTree(dir: File): Boolean = try {
        Files.walk(dir.toPath()).use { s -> s.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        true
    } catch (_: Exception) {
        false
    }
}
