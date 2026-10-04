package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderMoveTest {
    init { FolderMove.log = {} }

    private fun tmp(): File = Files.createTempDirectory("folder-move").toFile()

    @Test fun theOldFolderMovesWholeToTheRoot() {
        val storage = tmp()
        val legacy = File(storage, "Documents/Neo Quiz").apply { mkdirs() }
        File(legacy, ".neo-quiz/journal").mkdirs()
        File(legacy, ".neo-quiz/journal/phone.jsonl").writeText("{}\n")
        File(legacy, "Quiz.md").writeText("q")
        val target = File(storage, "Neo Quiz")
        FolderMove.move(legacy, target)
        assertFalse(legacy.exists())
        assertEquals("q", File(target, "Quiz.md").readText())
        assertEquals("{}\n", File(target, ".neo-quiz/journal/phone.jsonl").readText())
        assertFalse(FolderMove.blocked(legacy))
        // Idempotent: a second run changes nothing.
        FolderMove.move(legacy, target)
        assertTrue(File(target, "Quiz.md").isFile)
    }

    @Test fun anEmptyNewFolderIsReplaced() {
        val storage = tmp()
        val legacy = File(storage, "Documents/Neo Quiz").apply { mkdirs() }
        File(legacy, "Quiz.md").writeText("q")
        val target = File(storage, "Neo Quiz").apply { mkdirs() }
        FolderMove.move(legacy, target)
        assertTrue(File(target, "Quiz.md").isFile)
        assertFalse(legacy.exists())
    }

    @Test fun twoFullFoldersAreNeverMergedAndSyncIsBlocked() {
        val storage = tmp()
        val legacy = File(storage, "Documents/Neo Quiz").apply { mkdirs() }
        File(legacy, "Old.md").writeText("o")
        val target = File(storage, "Neo Quiz").apply { mkdirs() }
        File(target, "New.md").writeText("n")
        FolderMove.move(legacy, target)
        assertTrue(File(legacy, "Old.md").isFile)
        assertFalse(File(target, "Old.md").exists())
        assertTrue(FolderMove.blocked(legacy))
    }

    @Test fun onlyPathsAtOrUnderTheOldFolderMove() {
        val from = "/storage/emulated/0/Documents/Neo Quiz"
        val to = "/storage/emulated/0/Neo Quiz"
        assertEquals(to, FolderMove.movedPath(from, from, to))
        assertEquals("$to/XTI301", FolderMove.movedPath("$from/XTI301", from, to))
        assertEquals("$from 2", FolderMove.movedPath("$from 2", from, to))
        assertEquals("/storage/emulated/0/Download", FolderMove.movedPath("/storage/emulated/0/Download", from, to))
    }
}
