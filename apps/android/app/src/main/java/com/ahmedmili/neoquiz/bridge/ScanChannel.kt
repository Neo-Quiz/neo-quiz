package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray

/**
 * Roots, folder scan and file events: `demarrer`, `fichiers.liste`, `surveiller`.
 * Mirror of `apps/windows/electron/parcours.ts` (what a scan returns and which
 * folders it skips) and of what `index-fichiers.ts` pushes (`EvenementDisque`).
 *
 * There is no file watcher on Android. A scan keeps an index (path to mtime and
 * size) per root; [rescan] scans again and DIFFS against it, which yields the
 * same `create` / `modify` / `delete` events the Electron watcher pushes. It is
 * triggered by the app coming to the foreground (`ON_START`) and, in Task 10, by
 * the sync going idle. A file rename comes out as `delete` + `create`: the
 * renderer pairs them itself (`createRenameDetector`), exactly as it does for
 * chokidar. Directory renames (`renameDir`) are not paired here.
 *
 * Order of the renderer: `demarrer`, then `liste` per root (hydration, which is
 * also the baseline of the index), then `surveiller`. A root without a baseline
 * is never diffed: nothing is emitted for files the renderer was never told about.
 */
class ScanChannel(private val perimeter: Perimeter, private val emit: (Map<String, Any?>) -> Unit) {
    private class Stamp(val mtime: Long, val size: Long)

    private val lock = Mutex()
    @Volatile private var started: List<File> = emptyList()
    private val index = HashMap<String, Map<String, Stamp>>()
    @Volatile private var watching = false

    fun startedRoots(): List<File> = started

    /**
     * Stores the roots the renderer declared, filtered against the perimeter. A
     * page that (re)loads starts over: it hydrates with `liste` right after, so no
     * event is owed to it until it calls `surveiller` again.
     */
    suspend fun demarrer(racines: List<String>) = lock.withLock {
        started = racines.filter { perimeter.contains(it) }.map { perimeter.check(it) }
        watching = false
        index.keys.retainAll(started.map { key(it) }.toSet())
    }

    /** ALL the files of a root (recursively, same rules as `parcours.ts`), and the new baseline of its index. */
    suspend fun liste(racine: String): List<Map<String, Any?>> {
        val root = perimeter.check(racine)
        return lock.withLock {
            val files = scan(root)
            index[key(root)] = files
            files.map { (path, s) -> mapOf("chemin" to path, "mtime" to datedOnlyIfMarkdown(path, s)) }
        }
    }

    fun surveiller() {
        watching = true
    }

    /**
     * Scans every started root that has a baseline and emits what changed since.
     * Does NOTHING until `surveiller`: the baseline stays what the renderer was
     * last told (`liste`), so a change that lands between the hydration and the
     * subscription is still diffed and delivered afterwards, never swallowed.
     */
    suspend fun rescan() = lock.withLock {
        if (!watching) return@withLock
        for (root in started) {
            val before = index[key(root)] ?: continue
            val now = scan(root)
            index[key(root)] = now
            for (path in before.keys) if (path !in now) emit(mapOf("kind" to "delete", "abs" to path))
            for ((path, s) in now) {
                val old = before[path]
                if (old == null) emit(mapOf("kind" to "create", "abs" to path, "mtime" to datedOnlyIfMarkdown(path, s)))
                else if (old.mtime != s.mtime || old.size != s.size) emit(mapOf("kind" to "modify", "abs" to path, "mtime" to datedOnlyIfMarkdown(path, s)))
            }
        }
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "demarrer" to { a -> demarrer(a.optJSONArray(0).strings()) },
        "surveiller" to { _ -> surveiller() },
        "fichiers.liste" to { a -> liste(a.path(0)) },
    )

    private fun key(root: File) = root.path.replace('\\', '/').trimEnd('/')

    /** `mtime` only on `.md` (the catalogue is the one reader); the others keep 0, which `HostFile` allows. */
    private fun datedOnlyIfMarkdown(path: String, s: Stamp): Long = if (path.lowercase().endsWith(".md")) s.mtime else 0L

    /**
     * One walk, one `stat` per file (the attributes come with the directory
     * entry): hidden folders and `node_modules` are not entered, symbolic links
     * are skipped (a link to a parent would loop), an unreadable folder is
     * skipped without emptying the rest.
     */
    private suspend fun scan(root: File): Map<String, Stamp> = withContext(Dispatchers.IO) {
        val out = HashMap<String, Stamp>()
        val base = key(root)
        val rootPath = root.toPath()
        Files.walkFileTree(rootPath, object : SimpleFileVisitor<Path>() {
            override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                if (dir == rootPath) return FileVisitResult.CONTINUE
                return if (ignoredFolder(dir.fileName.toString())) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
            }

            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                if (attrs.isRegularFile && !attrs.isSymbolicLink) {
                    out["$base/${rootPath.relativize(file).joinToString("/")}"] = Stamp(attrs.lastModifiedTime().toMillis(), attrs.size())
                }
                return FileVisitResult.CONTINUE
            }

            override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE
        })
        out
    }

    /** `dossierIgnore` of `apps/windows/electron/catalogue.ts`. */
    private fun ignoredFolder(name: String) = name.startsWith(".") || name == "node_modules"

    companion object {
        /** Whether a written path can be in the page's catalogue: none of its segments is an
            ignored folder (`ignoredFolder`) nor a dot file. Journals (`.neo-quiz`), the trash
            and an import's staging folder are not, so a write there needs no rescan. */
        fun visibleToCatalogue(path: String): Boolean =
            path.replace('\\', '/').split('/').filter { it.isNotEmpty() }
                .none { it.startsWith(".") || it == "node_modules" }
    }
}
