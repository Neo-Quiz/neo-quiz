package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.io.IOException
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The security perimeter of the bridge, mirror of `apps/windows/electron/perimetre.ts`:
 * the renderer names paths, and only paths that resolve (symlinks and `..`
 * followed on the disk, via the canonical file) to a root or below one reach a
 * primitive. The app-private directory (it holds `settings.json`, whose
 * `folders` key feeds the roots on the next start) is NEVER reachable, even
 * when a root contains it: otherwise a hostile renderer could write that file
 * raw and widen the perimeter persistently. The [excluded] folders (other apps' and this
 * app's external data) are refused the same way.
 */
class Perimeter(
    private val roots: () -> List<File>,
    private val privateDir: File,
    /** Folders never reachable even inside a root (`Android/data`, `Android/obb`, the app's external dirs). */
    private val excluded: () -> List<File> = { emptyList() },
) {

    /** The canonical file when [abs] is inside the perimeter; throws `SecurityException("outside-perimeter")` otherwise. */
    fun check(abs: String): File {
        if (abs.isBlank()) throw refused()
        val file = File(abs)
        if (!file.isAbsolute) throw refused()
        val canonical = canonical(file) ?: throw refused()
        val priv = canonical(privateDir)
        if (priv != null && under(canonical, priv)) throw refused()
        if (excluded().any { e -> canonical(e)?.let { under(canonical, it) } == true }) throw refused()
        if (roots().none { r -> canonical(r)?.let { under(canonical, it) } == true }) throw refused()
        return canonical
    }

    fun contains(abs: String): Boolean = try {
        check(abs)
        true
    } catch (_: SecurityException) {
        false
    }

    /** True when [abs] IS a root (what `trash(abs, racine)` demands of its second argument). */
    fun isRoot(abs: String): Boolean = try {
        val c = check(abs)
        roots().any { canonical(it) == c }
    } catch (_: SecurityException) {
        false
    }

    private fun refused() = SecurityException("outside-perimeter")

    private fun canonical(f: File): File? = resolveReal(f)

    private fun under(f: File, root: File): Boolean = f.toPath().startsWith(root.toPath())
}

/**
 * The path as the disk knows it: `..` folded, symlinks (and junctions) followed
 * on the longest EXISTING ancestor, the rest appended (a note not yet created is
 * judged by its folder). `null` when no ancestor can be resolved. Not
 * `File.canonicalFile`: on Windows the JDK does not follow links with it, and
 * the unit tests run there; `toRealPath` does on every platform.
 */
internal fun resolveReal(f: File): File? {
    var current: Path? = f.toPath().toAbsolutePath().normalize()
    val rest = ArrayDeque<String>()
    while (current != null) {
        try {
            var real = current.toRealPath()
            for (segment in rest) real = real.resolve(segment)
            return real.toFile()
        } catch (_: IOException) {
            current.fileName?.let { rest.addFirst(it.toString()) }
            current = current.parent
        }
    }
    return null
}

/**
 * The roots the perimeter is fed with, and nothing else: the folders kept in
 * the settings at startup, the default folder, the folder picked by the user
 * (Task 8). Never the argument of `demarrer`: it comes from the renderer.
 */
class AllowedRoots {
    private val list = CopyOnWriteArrayList<File>()

    fun roots(): List<File> = list.toList()

    /** Adds an existing directory (resolved on the disk); anything else is ignored. */
    fun allow(dir: File) {
        val c = resolveReal(dir) ?: return
        if (c.isDirectory && list.none { it == c }) list.add(c)
    }
}
