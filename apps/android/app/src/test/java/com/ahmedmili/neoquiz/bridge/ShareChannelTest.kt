package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ShareChannelTest {
    private lateinit var dir: File
    private val sent = ArrayList<Pair<File, String>>()
    private var clock = 1_000_000L
    private var accept = true
    private lateinit var channel: ShareChannel

    private fun b64(n: Int) = Base64.getEncoder().encodeToString(ByteArray(n) { 7 })

    @Before
    fun setUp() {
        dir = File(Files.createTempDirectory("share").toFile(), "share")
        channel = ShareChannel(dir, { f, m -> sent.add(f to m); accept }, { clock })
    }

    @Test fun anOrdinaryZipGoesToTheShareSheet() = runBlocking {
        val name = channel.enregistrer("XTI301 - Écosystème Python.zip", b64(100))
        assertEquals("XTI301 - Écosystème Python.zip", name)
        assertEquals(1, sent.size)
        val (file, mime) = sent[0]
        assertEquals("application/zip", mime)
        assertEquals(100, file.length())
        // Under the cache's share folder, in a fresh sub-folder: nothing else is ever exposed.
        assertEquals(dir.canonicalPath, file.parentFile.parentFile.canonicalPath)
    }

    @Test fun aMarkdownFileIsSharedAsText() = runBlocking {
        channel.enregistrer("CM1.md", b64(10))
        assertEquals("text/markdown", sent[0].second)
    }

    @Test fun aNameIsAlwaysANameNeverAPath() = runBlocking {
        channel.enregistrer("..\\..\\Startup\\x.zip", b64(10))
        val file = sent[0].first
        assertEquals("-..-Startup-x.zip", file.name)
        assertEquals(dir.canonicalPath, file.parentFile.parentFile.canonicalPath)
    }

    @Test fun anExtensionOutsideTheListIsRefused() {
        for (n in listOf("x.apk", "x.bat", "x.html", "x", "x.zip.apk", "x.", ".zip")) {
            assertNull(n, FileShare.name(n))
        }
        assertEquals("x.ZIP", FileShare.name("x.ZIP"))
        assertNull(FileShare.name("x.bat."))
        assertNull(FileShare.name(42))
        assertNull(FileShare.name("a".repeat(200) + ".zip"))
        assertEquals("a-b.zip", FileShare.name("a/b.zip"))
    }

    @Test fun aWindowsDeviceNameIsRefusedForEveryExtension() {
        for (n in listOf("CON.zip", "con.md", "nul.zip", "Aux.md", "com1.zip", "LPT9.md", "con.txt.md", "con .md", "COM¹.zip", "conin\$.md")) {
            assertNull(n, FileShare.name(n))
        }
        assertEquals("console.md", FileShare.name("console.md"))
        assertEquals("com10.zip", FileShare.name("com10.zip"))
    }

    @Test fun refusedNamesAndContentsThrowAndShareNothing() {
        for ((n, c) in listOf<Pair<Any?, Any?>>("x.bat" to b64(5), "x.zip" to "", "x.zip" to "%%%not base64", "x.zip" to null, null to b64(5))) {
            assertThrows(IllegalArgumentException::class.java) { runBlocking { channel.enregistrer(n, c); clock += 5_000 } }
        }
        assertTrue(sent.isEmpty())
    }

    @Test fun theSizeBoundIsEnforcedBeforeDecoding() {
        assertEquals(FileShare.MAX_BYTES, FileShare.bytes(b64(FileShare.MAX_BYTES))?.size)
        assertNull(FileShare.bytes(b64(FileShare.MAX_BYTES + 1)))
        assertNull(FileShare.bytes("A".repeat(((FileShare.MAX_BYTES / 3) + 2) * 4)))
    }

    @Test fun aSecondShareTooSoonIsBusy() = runBlocking {
        channel.enregistrer("a.zip", b64(5))
        clock += 1_999
        val e = assertThrows(IllegalStateException::class.java) { runBlocking { channel.enregistrer("b.zip", b64(5)) } }
        assertEquals(ShareChannel.BUSY, e.message)
        clock += 1
        channel.enregistrer("b.zip", b64(5))
        assertEquals(2, sent.size)
    }

    @Test fun whenNothingCanOpenTheSheetTheAnswerIsNull() = runBlocking {
        accept = false
        assertNull(channel.enregistrer("a.zip", b64(5)))
    }

    @Test fun oldSharesArePurgedAndYoungOnesKept() = runBlocking {
        channel.enregistrer("old.zip", b64(5))
        val old = sent[0].first.parentFile
        old.setLastModified(clock - ShareChannel.MAX_AGE_MS - 1)
        clock += 5_000
        channel.enregistrer("new.zip", b64(5))
        assertFalse(old.exists())
        assertTrue(sent[1].first.exists())
    }

    @Test fun aFailedShareLeavesNothingAndDoesNotBlockTheNextOne() = runBlocking {
        accept = false
        assertNull(channel.enregistrer("a.zip", b64(5)))
        // No half share stays in the cache, and the user may try again at once (no 2 s wait after a failure).
        assertEquals(0, dir.listFiles()?.size ?: 0)
        accept = true
        assertEquals("a.zip", channel.enregistrer("a.zip", b64(5)))
    }

    @Test fun aSenderThatThrowsReleasesTheGuard() {
        var explode = true
        val ch = ShareChannel(dir, { _, _ -> if (explode) throw IllegalStateException("no activity") else true }, { clock })
        assertThrows(IllegalStateException::class.java) { runBlocking { ch.enregistrer("a.zip", b64(5)) } }
        assertEquals(0, dir.listFiles()?.size ?: 0)
        // Same clock, no wait: the guard was given back.
        explode = false
        assertEquals("b.zip", runBlocking { ch.enregistrer("b.zip", b64(5)) })
    }

}
