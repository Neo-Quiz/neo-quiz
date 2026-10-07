package com.ahmedmili.neoquiz.sync

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class StagingCleanupTest {
    private val now = 10_000_000_000L
    private fun dir(parent: File, name: String, modified: Long) = File(parent, name).apply { mkdirs(); File(this, "x.md").writeText("x"); setLastModified(modified) }

    @Test fun anOldStagingFolderIsRemovedAYoungOrOtherlyNamedOneKept() {
        val root = Files.createTempDirectory("shared").toFile()
        val cours = File(root, "Cours").apply { mkdirs() }
        val old = dir(cours, ".import-0123456789ab", now - StagingCleanup.MAX_AGE_MS - 1)
        val oldAtRoot = dir(root, ".import-abcdefabcdef", now - 5 * StagingCleanup.MAX_AGE_MS)
        val young = dir(cours, ".import-ffffffffffff", now - 60_000)
        val lookalike = dir(cours, ".import-notmine", now - 5 * StagingCleanup.MAX_AGE_MS)
        val user = dir(cours, "import-0123456789ab", now - 5 * StagingCleanup.MAX_AGE_MS)
        assertEquals(2, StagingCleanup.purge(root, now))
        assertFalse(old.exists())
        assertFalse(oldAtRoot.exists())
        assertTrue(young.exists())
        assertTrue(lookalike.exists())
        assertTrue(user.exists())
    }

    @Test fun aLinkIsNeverFollowedOutOfTheSharedFolder() {
        val root = Files.createTempDirectory("shared").toFile()
        val outside = Files.createTempDirectory("outside").toFile()
        val precious = File(outside, "keep.txt").apply { writeText("keep") }
        val staging = File(root, ".import-0123456789ab").apply { mkdirs(); setLastModified(now - 5 * StagingCleanup.MAX_AGE_MS) }
        val link = File(staging, "out")
        val made = try { Files.createSymbolicLink(link.toPath(), outside.toPath()); true } catch (_: Exception) { false }
        assumeTrue("symbolic links unavailable here", made)
        staging.setLastModified(now - 5 * StagingCleanup.MAX_AGE_MS)
        StagingCleanup.purge(root, now)
        assertTrue("the target of a link stays", precious.exists())
        assertFalse(staging.exists())
    }
}
