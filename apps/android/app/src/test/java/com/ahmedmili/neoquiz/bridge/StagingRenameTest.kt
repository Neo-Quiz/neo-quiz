package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The import writes into `<parent>/.import-<id>` (ignored by Syncthing) and puts a NEW folder in place
 * with ONE rename (`share-import.ts`): these are the bridge primitives that sequence relies on.
 */
class StagingRenameTest {
    private lateinit var root: File
    private lateinit var files: FilesChannel

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("staging").toFile().canonicalFile
        root = File(base, "Neo Quiz").apply { mkdirs() }
        val allowed = AllowedRoots().apply { allow(root) }
        files = FilesChannel(Perimeter(allowed::roots, File(base, "private").apply { mkdirs() }), allowed)
    }

    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())

    @Test fun aStagedFolderAppearsWholeWithOneRename() = runBlocking {
        val staging = File(root, ".import-ab12").path
        files.mkdirs("$staging/Sub")
        files.writeBinary("$staging/CM1.md", b64("one"))
        files.writeBinary("$staging/Sub/CM2.md", b64("two"))
        // Until the rename the synced folder holds only the ignored staging folder.
        assertEquals(listOf(".import-ab12"), root.list()!!.toList())
        files.rename(staging, File(root, "Cours").path)
        assertEquals(listOf("Cours"), root.list()!!.toList())
        assertEquals("one", File(root, "Cours/CM1.md").readText())
        assertEquals("two", File(root, "Cours/Sub/CM2.md").readText())
    }

    @Test fun anExistingTargetIsNeverReplaced() = runBlocking {
        File(root, "Cours").mkdirs()
        File(root, "Cours/mine.md").writeText("mine")
        val staging = File(root, ".import-cd34").path
        files.mkdirs(staging)
        files.writeBinary("$staging/CM1.md", b64("one"))
        assertThrows(IllegalStateException::class.java) { runBlocking { files.rename(staging, File(root, "Cours").path) } }
        assertEquals("mine", File(root, "Cours/mine.md").readText())
        assertFalse(File(root, "Cours/CM1.md").exists())
        assertTrue(File(root, ".import-cd34/CM1.md").exists())
    }

    @Test fun aRefusedWriteLeavesOnlyTheIgnoredStagingFolder() = runBlocking {
        val staging = File(root, ".import-ef56").path
        files.mkdirs(staging)
        files.writeBinary("$staging/CM1.md", b64("one"))
        // A path outside the perimeter is refused: the import throws before any rename.
        assertThrows(SecurityException::class.java) { runBlocking { files.writeBinary("${root.parentFile.path}/outside.md", b64("x")) } }
        assertEquals(listOf(".import-ef56"), root.list()!!.toList())
    }
}
