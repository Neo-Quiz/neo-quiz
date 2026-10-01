package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PerimeterTest {
    private lateinit var base: File
    private lateinit var root: File
    private lateinit var outside: File
    private lateinit var privateDir: File
    private lateinit var perimeter: Perimeter

    @Before
    fun setUp() {
        base = Files.createTempDirectory("perimeter").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        outside = File(base, "outside").apply { mkdirs() }
        privateDir = File(base, "private").apply { mkdirs() }
        perimeter = Perimeter({ listOf(root) }, privateDir)
    }

    private fun refused(path: String) {
        val e = assertThrows(SecurityException::class.java) { perimeter.check(path) }
        assertEquals("outside-perimeter", e.message)
    }

    @Test fun fileUnderRootIsAccepted() {
        assertEquals(File(root, "a.md").canonicalFile, perimeter.check(File(root, "a.md").path))
    }

    @Test fun rootItselfIsAccepted() {
        assertEquals(root.canonicalFile, perimeter.check(root.path))
    }

    @Test fun dotDotEscapeIsRefused() {
        refused(root.path + File.separator + ".." + File.separator + "x")
    }

    @Test fun siblingWithSharedPrefixIsRefused() {
        refused(File(base, "root-evil/a.md").path)
    }

    @Test fun symlinkInRootPointingOutsideIsRefused() {
        val link = File(root, "link")
        makeLink(link, outside)
        refused(File(link, "secret.md").path)
    }

    @Test fun excludedFoldersAreRefusedEvenInsideARoot() {
        val data = File(root, "Android/data").apply { mkdirs() }
        val obb = File(root, "Android/obb").apply { mkdirs() }
        val own = File(root, "Android/data/com.me/files").apply { mkdirs() }
        val p = Perimeter({ listOf(root) }, privateDir, { listOf(data, obb, own) })
        for (f in listOf(data, obb, File(data, "x/y.md"), File(obb, "z.obb"), File(own, "q.md"))) {
            val e = assertThrows(f.path, SecurityException::class.java) { p.check(f.path) }
            assertEquals("outside-perimeter", e.message)
        }
        assertTrue(p.check(File(root, "Android/media/ok.md").path).path.startsWith(root.path))
    }

    @Test fun privateDirIsRefusedEvenWhenARootContainsIt() {
        val wide = Perimeter({ listOf(base) }, privateDir)
        val e = assertThrows(SecurityException::class.java) { wide.check(File(privateDir, "settings.json").path) }
        assertEquals("outside-perimeter", e.message)
        assertTrue(wide.check(File(root, "a.md").path).path.startsWith(root.path))
    }

    @Test fun emptyAndRelativePathsAreRefused() {
        refused("")
        refused("   ")
        refused("a.md")
        refused("../a.md")
    }

    @Test fun isRootOnlyTrueForARoot() {
        assertTrue(perimeter.isRoot(root.path))
        assertTrue(!perimeter.isRoot(File(root, "sub").path))
        assertTrue(!perimeter.isRoot(outside.path))
    }

    /** A symlink, or a junction where Windows refuses symlinks without privileges. */
    private fun makeLink(link: File, target: File) {
        try {
            Files.createSymbolicLink(link.toPath(), target.toPath())
        } catch (e: Exception) {
            val p = ProcessBuilder("cmd", "/c", "mklink", "/J", link.path, target.path).redirectErrorStream(true).start()
            p.inputStream.readBytes()
            assertEquals("could not create link", 0, p.waitFor())
        }
    }
}
