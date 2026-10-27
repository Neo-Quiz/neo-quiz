package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RootRenameTest {
    init { RootRename.log = {} }

    private fun tmp(): File = Files.createTempDirectory("root-rename").toFile()

    /** A synced folder with the name files the PCs publish. */
    private fun root(storage: File, name: String, vararg published: Pair<String, String>): File {
        val r = File(storage, name).apply { mkdirs() }
        File(r, ".stfolder").mkdirs()
        File(r, "Quiz.md").writeText("q")
        val dir = File(r, RootRename.DIR).apply { mkdirs() }
        for ((file, text) in published) File(dir, file).writeText(text)
        return r
    }

    private fun named(n: String) = """{ "v": 1, "name": "$n" }"""

    @Test fun validNames() {
        assertTrue(RootRename.isValidName("Efrei"))
        assertTrue(RootRename.isValidName("Neo Quiz"))
        assertTrue(RootRename.isValidName("Cours B2 (2026)"))
        assertTrue(RootRename.isValidName("École"))
        for (bad in listOf("", " Efrei", "Efrei ", ".Efrei", "Efrei.", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a|b",
            "a\u0000b", "a\nb", "..", ".", "Download", "android", "DCIM", "x".repeat(101))) {
            assertFalse("'$bad' must be refused", RootRename.isValidName(bad))
        }
        // A decomposed accent (NFD) is not the name the folder would get: refused.
        assertFalse(RootRename.isValidName("École"))
    }

    @Test fun theNameEveryPcAgreesOnIsTheDesiredOne() {
        val storage = tmp()
        val r = root(storage, "Neo Quiz", "e45a22d9-fd2f.json" to named("Efrei"), "79de58ad-fd6c.json" to named("Efrei"))
        assertEquals("Efrei", RootRename.desiredName(r))
    }

    @Test fun twoDifferentNamesMeanNoRename() {
        val storage = tmp()
        val r = root(storage, "Neo Quiz", "pc.json" to named("Efrei"), "laptop.json" to named("Neo Quiz"))
        assertNull(RootRename.desiredName(r))
    }

    @Test fun noFileOrNoFolderMeansNoRename() {
        val storage = tmp()
        assertNull(RootRename.desiredName(File(storage, "Neo Quiz").apply { mkdirs() }))
        assertNull(RootRename.desiredName(File(storage, "absent")))
    }

    @Test fun hostileOrForeignFilesAreIgnored() {
        val storage = tmp()
        val r = root(
            storage, "Neo Quiz",
            "pc.json" to named("Efrei"),
            // A conflict copy, a temporary file, another version, a broken file, an invalid name, a non-string name: all ignored.
            "pc.sync-conflict-20261027-120000-ABCDEFG.json" to named("Autre"),
            "pc.json.tmp" to named("Autre"),
            "v2.json" to """{ "v": 2, "name": "Autre" }""",
            "broken.json" to "{ not json",
            "bad.json" to named("Download"),
            "num.json" to """{ "v": 1, "name": 42 }""",
        )
        assertEquals("Efrei", RootRename.desiredName(r))
        // An oversized file is not even read.
        File(r, "${RootRename.DIR}/big.json").writeText("""{ "v": 1, "name": "Autre", "pad": "${"x".repeat(5000)}" }""")
        assertEquals("Efrei", RootRename.desiredName(r))
    }

    @Test fun theFolderMovesWholeAndOnce() {
        val storage = tmp()
        root(storage, "Neo Quiz", "pc.json" to named("Efrei"))
        val moved = RootRename.move(storage, "Neo Quiz", "Efrei")
        assertEquals(File(storage, "Efrei"), moved)
        assertFalse(File(storage, "Neo Quiz").exists())
        assertEquals("q", File(storage, "Efrei/Quiz.md").readText())
        assertTrue(File(storage, "Efrei/.stfolder").isDirectory)
        assertTrue(File(storage, "Efrei/${RootRename.DIR}/pc.json").isFile)
        // Idempotent: the old folder is gone, nothing moves again.
        assertNull(RootRename.move(storage, "Neo Quiz", "Efrei"))
        assertTrue(File(storage, "Efrei/Quiz.md").isFile)
    }

    @Test fun anEmptyTargetIsReplaced() {
        val storage = tmp()
        root(storage, "Neo Quiz")
        File(storage, "Efrei").mkdirs()
        assertEquals(File(storage, "Efrei"), RootRename.move(storage, "Neo Quiz", "Efrei"))
        assertTrue(File(storage, "Efrei/Quiz.md").isFile)
    }

    @Test fun aTargetHoldingSomethingIsNeverMergedNorTouched() {
        val storage = tmp()
        root(storage, "Neo Quiz")
        File(storage, "Efrei").mkdirs()
        File(storage, "Efrei/Other.md").writeText("o")
        assertNull(RootRename.move(storage, "Neo Quiz", "Efrei"))
        assertTrue(File(storage, "Neo Quiz/Quiz.md").isFile)
        assertEquals("o", File(storage, "Efrei/Other.md").readText())
        assertFalse(File(storage, "Efrei/Quiz.md").exists())
    }

    @Test fun theTargetIsJudgedBeforeAnythingIsRecorded() {
        val storage = tmp()
        root(storage, "Neo Quiz")
        assertTrue(RootRename.canMove(storage, "Neo Quiz", "Efrei"))
        File(storage, "Efrei").mkdirs()
        assertTrue("an empty target may be replaced", RootRename.canMove(storage, "Neo Quiz", "Efrei"))
        File(storage, "Efrei/Other.md").writeText("o")
        assertFalse("a target holding something refuses", RootRename.canMove(storage, "Neo Quiz", "Efrei"))
        assertFalse(RootRename.canMove(storage, "Neo Quiz", "neo quiz"))
        assertFalse(RootRename.canMove(storage, "Neo Quiz", "Download"))
        assertFalse(RootRename.canMove(storage, "Absent", "Autre"))
        // Judging moves nothing.
        assertTrue(File(storage, "Neo Quiz/Quiz.md").isFile)
    }

    @Test fun aTargetThatIsAFileIsNeverTouched() {
        val storage = tmp()
        root(storage, "Neo Quiz")
        File(storage, "Efrei").writeText("a file")
        assertNull(RootRename.move(storage, "Neo Quiz", "Efrei"))
        assertEquals("a file", File(storage, "Efrei").readText())
        assertTrue(File(storage, "Neo Quiz/Quiz.md").isFile)
    }

    @Test fun nothingMovesForTheSameNameACaseChangeAnInvalidNameOrNoFolder() {
        val storage = tmp()
        root(storage, "Neo Quiz")
        assertNull(RootRename.move(storage, "Neo Quiz", "Neo Quiz"))
        assertNull(RootRename.move(storage, "Neo Quiz", "neo quiz"))
        assertNull(RootRename.move(storage, "Neo Quiz", "Download"))
        assertNull(RootRename.move(storage, "Neo Quiz", "a/b"))
        assertNull(RootRename.move(storage, "Absent", "Efrei"))
        assertTrue(File(storage, "Neo Quiz/Quiz.md").isFile)
        assertFalse(File(storage, "Efrei").exists())
    }

    @Test fun theNamedRootIsTheCanonicalOne() {
        val storage = tmp()
        assertEquals(File(storage, "Neo Quiz"), ShareRules.sharedRoot(storage))
        assertEquals(File(storage, "Efrei"), ShareRules.sharedRoot(storage, "Efrei"))
        assertTrue(ShareRules.isCanonicalSharedRoot(File(storage, "Efrei"), storage, "Efrei"))
        assertFalse(ShareRules.isCanonicalSharedRoot(File(storage, "Neo Quiz"), storage, "Efrei"))
    }
}
