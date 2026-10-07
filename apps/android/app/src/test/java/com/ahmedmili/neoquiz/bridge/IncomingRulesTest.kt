package com.ahmedmili.neoquiz.bridge

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingRulesTest {
    private val pkg = "com.ahmedmili.neoquiz"
    private fun decide(name: String?, size: Long? = 100, scheme: String? = "content", authority: String? = "com.android.providers.downloads.documents") =
        IncomingRules.decide(scheme, authority, pkg, name, size)

    @Test fun aZipAndANoteFromAnotherAppAreAccepted() {
        assertEquals(IncomingRules.Verdict.Accept("zip", "XTI301.zip"), decide("XTI301.zip"))
        assertEquals(IncomingRules.Verdict.Accept("md", "CM1.MD"), decide("CM1.MD"))
    }

    @Test fun theNameDecidesNeverTheAnnouncedType() {
        for (n in listOf("x.apk", "x.bat", "x.zip.apk", "photo.png", "x", null, "")) {
            assertEquals(n, IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide(n))
        }
    }

    @Test fun theSizeIsRefusedBeforeReadingWhenKnown() {
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.TOO_LARGE), decide("a.zip", IncomingRules.MAX_BYTES + 1))
        assertTrue(decide("a.zip", IncomingRules.MAX_BYTES) is IncomingRules.Verdict.Accept)
        assertTrue("unknown size is bounded while reading", decide("a.zip", null) is IncomingRules.Verdict.Accept)
    }

    @Test fun anAuthorityWithAUserIdIsRefusedBecauseAndroidDropsIt() {
        // `content://0@<our fileprovider>/..` resolves to OUR provider (all the storage): refused on the spelling.
        for (a in listOf("0@com.ahmedmili.neoquiz.fileprovider", "10@com.ahmedmili.neoquiz.fileprovider", "0@com.ahmedmili.neoquiz", "x@y@com.other", "@")) {
            assertEquals(a, IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", authority = a))
        }
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", authority = "com.ahmedmili.neoquiz.share"))
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", authority = "COM.AHMEDMILI.NEOQUIZ.fileprovider"))
        assertTrue(decide("a.zip", authority = "com.discord.fileprovider") is IncomingRules.Verdict.Accept)
        assertTrue(decide("a.zip", authority = "media") is IncomingRules.Verdict.Accept)
    }

    @Test fun aProviderTheSystemSaysIsOursIsRefused() {
        assertTrue(IncomingRules.servedByUs("com.ahmedmili.neoquiz", pkg))
        assertTrue(IncomingRules.servedByUs("COM.AHMEDMILI.NEOQUIZ", pkg))
        assertFalse(IncomingRules.servedByUs("com.discord", pkg))
        assertFalse(IncomingRules.servedByUs(null, pkg))
    }

    @Test fun onlyAContentUriOfAnotherAppIsRead() {
        // file: would reach the app's own private files; the app's own providers need no grant.
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", scheme = "file", authority = null))
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", scheme = null))
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", authority = "com.ahmedmili.neoquiz.fileprovider"))
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.WRONG_TYPE), decide("a.zip", authority = "COM.AHMEDMILI.NEOQUIZ.share"))
        assertEquals(IncomingRules.Verdict.Reject(IncomingRules.UNREADABLE), decide("a.zip", authority = null))
        // A look-alike authority is another app's.
        assertTrue(decide("a.zip", authority = "com.ahmedmili.neoquizz.files") is IncomingRules.Verdict.Accept)
    }

    @Test fun aNameNeverBecomesAPath() {
        assertEquals("x.zip", IncomingRules.label("../../etc/x.zip"))
        assertEquals("x.zip", IncomingRules.label("C:\\Users\\a\\x.zip"))
        assertEquals("a-b.md", IncomingRules.label("a:b.md"))
        val long = IncomingRules.label("a".repeat(400) + ".zip")
        assertEquals(150, long.length)
        assertTrue(long.endsWith(".zip"))
        val v = decide("sub/dir/Cours.zip") as IncomingRules.Verdict.Accept
        assertEquals("Cours.zip", v.label)
    }

    @Test fun theCopyStopsTheMomentTheBoundIsPassed() {
        val out = ByteArrayOutputStream()
        assertEquals(10L, IncomingRules.copyBounded(ByteArrayInputStream(ByteArray(10)), out, 10))
        val over = ByteArrayOutputStream()
        assertThrows(IncomingRules.TooLarge::class.java) { IncomingRules.copyBounded(ByteArrayInputStream(ByteArray(200_000)), over, 70_000) }
        // It wrote at most the bound before stopping: never the whole stream.
        assertTrue(over.size() <= 70_000)
    }

    @Test fun anEndlessStreamIsCutNotRead() {
        val endless = object : java.io.InputStream() {
            override fun read() = 1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                java.util.Arrays.fill(b, off, off + len, 1)
                return len
            }
        }
        assertThrows(IncomingRules.TooLarge::class.java) { IncomingRules.copyBounded(endless, java.io.OutputStream.nullOutputStream(), 1_000_000) }
    }

    @Test fun oldCopiesArePurgedYoungOnesKept() {
        val dir = Files.createTempDirectory("incoming").toFile()
        val old = File(dir, "old.zip").apply { writeBytes(byteArrayOf(1)); setLastModified(1_000) }
        val young = File(dir, "young.zip").apply { writeBytes(byteArrayOf(1)); setLastModified(1_000_000) }
        IncomingIntent.purge(dir, 1_000_000 + 1)
        assertFalse(old.exists())
        assertTrue(young.exists())
        IncomingIntent.purge(dir, 1_000_000 + IncomingRules.MAX_AGE_MS + 1)
        assertFalse(young.exists())
    }

    @Test fun theInboxGivesAFileOnceAndDeletesItsCopy() {
        val inbox = IncomingInbox()
        val f = File.createTempFile("inbox", ".zip").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        var told = 0
        inbox.listener = { told++ }
        inbox.raise(IncomingInbox.Entry("a.zip", f, null))
        assertEquals(1, told)
        val got = inbox.takeForPage()!!
        assertEquals("a.zip", got["nom"])
        assertEquals("AQID", got["octets"])
        assertFalse(f.exists())
        assertNull(inbox.takeForPage())
    }

    @Test fun aNewerFileReplacesAndDeletesTheOlderCopy() {
        val inbox = IncomingInbox()
        val a = File.createTempFile("inbox-a", ".zip").apply { writeBytes(byteArrayOf(1)) }
        val b = File.createTempFile("inbox-b", ".zip").apply { writeBytes(byteArrayOf(2)) }
        inbox.raise(IncomingInbox.Entry("a.zip", a, null))
        inbox.raise(IncomingInbox.Entry("b.zip", b, null))
        assertFalse(a.exists())
        assertEquals("b.zip", inbox.takeForPage()!!["nom"])
    }

    @Test fun aRefusalReachesThePageAsAnErrorOnce() {
        val inbox = IncomingInbox()
        inbox.raise(IncomingInbox.Entry(null, null, IncomingRules.TOO_LARGE))
        assertEquals(mapOf<String, Any?>("erreur" to "trop-grand"), inbox.takeForPage())
        assertNull(inbox.takeForPage())
    }

    @Test fun aCopyThatVanishedIsReportedUnreadable() {
        val inbox = IncomingInbox()
        inbox.raise(IncomingInbox.Entry("a.zip", File("does-not-exist.zip"), null))
        assertEquals(mapOf<String, Any?>("erreur" to "illisible"), inbox.takeForPage())
    }

    /** The golden and hostile archives of `check:share-roundtrip` cross the copy byte for byte: the
        import itself is the shared TypeScript code, whose results that script pins (`expected.json`). */
    @Test fun theSharedFixtureArchivesCrossTheCopyUnchanged() {
        val dir = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "scripts/fixtures/share") }.first { it.isDirectory }
        val zips = dir.walkTopDown().filter { it.isFile && it.extension == "zip" }.toList()
        assertTrue("fixtures found", zips.size >= 10)
        for (z in zips) {
            val original = z.readBytes()
            if (original.size <= IncomingRules.MAX_BYTES) {
                val out = ByteArrayOutputStream()
                IncomingRules.copyBounded(ByteArrayInputStream(original), out)
                assertEquals(z.name, sha(original), sha(out.toByteArray()))
            }
            assertTrue(z.name, decide(z.name, original.size.toLong()) is IncomingRules.Verdict.Accept)
        }
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
}
