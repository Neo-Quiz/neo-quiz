package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.io.FileOutputStream
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray

/**
 * The `fichiers.*` channels, mirror of `apps/windows/electron/fichiers.ts` and
 * of the file handlers of `canaux.ts`. Every path goes through the
 * [Perimeter] first (the renderer never reaches a primitive otherwise), and
 * the primitive then works on the CANONICAL file the perimeter returned.
 * Error messages and return values are those of the Electron handlers: the
 * shared renderer matches some of them as text.
 */
class FilesChannel(
    private val perimeter: Perimeter,
    private val allowed: AllowedRoots,
    /** Told about every path the page wrote, moved or removed (real-time sync, 2026-10-03). */
    private val onWrite: (String) -> Unit = {},
) {
    private val locks = ConcurrentHashMap<String, Mutex>()

    internal fun lockOf(f: File): Mutex = locks.getOrPut(f.path) { Mutex() }

    /** Runs [block] holding the locks of every file given, taken in path order (two renames crossing each other cannot deadlock). */
    private suspend fun <T> withLocks(vararg files: File, block: () -> T): T {
        val mutexes = files.map { it.path }.distinct().sorted().map { path -> locks.getOrPut(path) { Mutex() } }
        mutexes.forEach { it.lock() }
        try {
            return block()
        } finally {
            mutexes.reversed().forEach { it.unlock() }
        }
    }

    private fun mtimeOf(f: File): Map<String, Any?> = mapOf("mtime" to f.lastModified())

    suspend fun read(abs: String): String = perimeter.check(abs).readText(Charsets.UTF_8)

    suspend fun readBinary(abs: String): String =
        Base64.getEncoder().encodeToString(perimeter.check(abs).readBytes())

    suspend fun write(abs: String, contenu: String): Map<String, Any?> {
        val f = perimeter.check(abs)
        lockOf(f).withLock { atomicWrite(f, contenu.toByteArray(Charsets.UTF_8)) }
        return mtimeOf(f)
    }

    suspend fun writeBinary(abs: String, base64: String): Map<String, Any?> {
        val f = perimeter.check(abs)
        val bytes = Base64.getDecoder().decode(base64)
        lockOf(f).withLock { atomicWrite(f, bytes) }
        return mtimeOf(f)
    }

    /** Appends under a per-path lock: the append is carried by the file system, never a read-then-rewrite. */
    suspend fun append(abs: String, contenu: String): Map<String, Any?> {
        val f = perimeter.check(abs)
        // A link (even dangling) is never written through: its target could be anywhere.
        if (Files.isSymbolicLink(f.toPath())) throw SecurityException("outside-perimeter")
        lockOf(f).withLock {
            FileOutputStream(f, true).use { it.write(contenu.toByteArray(Charsets.UTF_8)) }
        }
        return mtimeOf(f)
    }

    suspend fun lirePourEcriture(abs: String): Map<String, Any?> {
        val f = perimeter.check(abs)
        return mapOf("contenu" to f.readText(Charsets.UTF_8), "mtime" to f.lastModified())
    }

    /** Writes only when the file still holds [lu] (compared on CONTENT, like the Electron side); `null` = changed, replay. */
    suspend fun ecrireSiInchange(abs: String, lu: String, contenu: String): Map<String, Any?>? {
        val f = perimeter.check(abs)
        return lockOf(f).withLock {
            if (f.readText(Charsets.UTF_8) != lu) null
            else {
                atomicWrite(f, contenu.toByteArray(Charsets.UTF_8))
                mtimeOf(f)
            }
        }
    }

    suspend fun exists(abs: String): Boolean = perimeter.check(abs).exists()

    suspend fun mkdirs(abs: String) {
        val f = perimeter.check(abs)
        if (!f.isDirectory && !f.mkdirs() && !f.isDirectory) throw java.io.IOException("cannot create $abs")
    }

    /** Moves to `<racine>/.trash/<relative path>`, numbering a homonym; never deletes. */
    suspend fun trash(abs: String, racine: String) {
        val a = perimeter.check(abs)
        if (!perimeter.isRoot(racine)) throw IllegalArgumentException("trash : racine inconnue : $racine")
        val r = perimeter.check(racine)
        if (a == r || !a.toPath().startsWith(r.toPath())) throw IllegalArgumentException("trash : ${a.path} n'est pas sous ${r.path}")
        val relative = r.toPath().relativize(a.toPath()).joinToString("/")
        withLocks(a) {
            val target = freePath(File(r, ".trash/$relative"))
            target.parentFile?.mkdirs()
            Files.move(a.toPath(), target.toPath())
        }
    }

    /** The FILES of a folder, without descending; an absent folder is `[]`. Normalised with `/`. */
    suspend fun list(dossier: String): List<String> {
        val d = perimeter.check(dossier)
        val base = d.path.replace('\\', '/').trimEnd('/')
        return d.listFiles().orEmpty()
            .filter { Files.isRegularFile(it.toPath(), LinkOption.NOFOLLOW_LINKS) }
            .map { "$base/${it.name}" }
    }

    /** ALL the entries (name + kind), without descending; a symlink is neither file nor folder here. */
    suspend fun listerDossier(dossier: String): List<Map<String, Any?>> =
        perimeter.check(dossier).listFiles().orEmpty().map {
            mapOf("name" to it.name, "isFolder" to Files.isDirectory(it.toPath(), LinkOption.NOFOLLOW_LINKS))
        }

    suspend fun remove(abs: String) {
        val f = perimeter.check(abs)
        withLocks(f) { if (!f.delete() && f.exists()) throw java.io.IOException("cannot remove $abs") }
    }

    /** Refuses when the destination exists (the review-log migration relies on it). */
    suspend fun rename(de: String, vers: String) {
        val from = perimeter.check(de)
        val to = perimeter.check(vers)
        withLocks(from, to) {
            try {
                Files.move(from.toPath(), to.toPath())
            } catch (_: FileAlreadyExistsException) {
                throw IllegalStateException("${to.path.replace('\\', '/')} existe déjà")
            }
        }
    }

    /** The mtime, or `null` when absent or a directory. */
    suspend fun stat(abs: String): Map<String, Any?>? {
        val f = perimeter.check(abs)
        return if (f.exists() && !f.isDirectory) mtimeOf(f) else null
    }

    suspend fun statEntree(abs: String): Map<String, Any?>? {
        val f = perimeter.check(abs)
        return if (f.exists()) mapOf("isFile" to f.isFile, "mtimeMs" to f.lastModified(), "size" to f.length()) else null
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "fichiers.read" to { a -> read(a.path(0)) },
        "fichiers.readCached" to { a -> read(a.path(0)) },
        "fichiers.readBinary" to { a -> readBinary(a.path(0)) },
        "fichiers.write" to { a -> write(a.path(0), a.text(1)).also { onWrite(a.path(0)) } },
        "fichiers.writeBinary" to { a -> writeBinary(a.path(0), a.text(1)).also { onWrite(a.path(0)) } },
        "fichiers.append" to { a -> append(a.path(0), a.text(1)).also { onWrite(a.path(0)) } },
        "fichiers.lirePourEcriture" to { a -> lirePourEcriture(a.path(0)) },
        "fichiers.ecrireSiInchange" to { a -> ecrireSiInchange(a.path(0), a.text(1), a.text(2)).also { if (it != null) onWrite(a.path(0)) } },
        "fichiers.exists" to { a -> exists(a.path(0)) },
        "fichiers.mkdirs" to { a -> mkdirs(a.path(0)) },
        "fichiers.trash" to { a -> trash(a.path(0), a.path(1)).also { onWrite(a.path(0)) } },
        "fichiers.list" to { a -> list(a.path(0)) },
        "fichiers.remove" to { a -> remove(a.path(0)).also { onWrite(a.path(0)) } },
        "fichiers.rename" to { a -> rename(a.path(0), a.path(1)).also { onWrite(a.path(0)); onWrite(a.path(1)) } },
        "fichiers.stat" to { a -> stat(a.path(0)) },
        "fichiers.statEntree" to { a -> statEntree(a.path(0)) },
        "fichiers.listerDossier" to { a -> listerDossier(a.path(0)) },
    )

    private fun freePath(wanted: File): File {
        val name = wanted.name
        val dot = name.lastIndexOf('.')
        val base = if (dot <= 0) name else name.substring(0, dot)
        val ext = if (dot <= 0) "" else name.substring(dot)
        for (n in 1..50) {
            val candidate = File(wanted.parentFile, if (n == 1) name else "$base-$n$ext")
            if (!candidate.exists()) return candidate
        }
        throw IllegalStateException("aucun nom de fichier libre après 50 essais : ${wanted.path}")
    }
}

/**
 * Temp file in the SAME directory, fsync, then an atomic move over the target:
 * a cut in the middle leaves the old content or the new, never a half file.
 */
internal fun atomicWrite(target: File, bytes: ByteArray) {
    val tmp = File(target.parentFile, ".${target.name}.${System.nanoTime()}.tmp")
    try {
        FileOutputStream(tmp).use {
            it.write(bytes)
            it.fd.sync()
        }
        Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } catch (e: Throwable) {
        tmp.delete()
        throw e
    }
}
