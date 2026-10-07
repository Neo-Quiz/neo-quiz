package com.ahmedmili.neoquiz.code

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LanguagePacksTest {
    private lateinit var base: File
    private lateinit var dir: File

    @Before
    fun setUp() {
        base = Files.createTempDirectory("packs").toFile().canonicalFile
        dir = File(base, "languages").apply { mkdirs() }
    }

    /** A "store" ZIP the way `buildZip` writes it: each payload is latin1 text wrapped in UTF-8. */
    private fun zip(entries: List<Pair<String, ByteArray>>): ByteArray {
        val out = ByteArrayOutputStream()
        fun le16(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff) }
        fun le32(v: Long) { le16((v and 0xffff).toInt()); le16(((v shr 16) and 0xffff).toInt()) }
        for ((name, data) in entries) {
            val nameBytes = name.toByteArray(Charsets.UTF_8)
            val payload = String(data, Charsets.ISO_8859_1).toByteArray(Charsets.UTF_8)
            le32(0x04034b50); le16(20); le16(0); le16(0); le16(0); le16(0)
            le32(0); le32(payload.size.toLong()); le32(payload.size.toLong())
            le16(nameBytes.size); le16(0)
            out.write(nameBytes)
            out.write(payload)
        }
        return out.toByteArray()
    }

    private fun gz(bytes: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(bytes) }
        return out.toByteArray()
    }

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun pinOf(pack: ByteArray) = Pin("1.0.0", "https://github.com/x/y.zip.gz", sha(pack), pack.size.toLong(), "pyodide.asm.wasm")

    private val binary = ByteArray(256) { it.toByte() }
    private fun good() = listOf("manifest.json" to """{"version":"1.0.0"}""".toByteArray(), "pyodide.asm.wasm" to binary, "sub/dir/a.txt" to "a".toByteArray())

    private fun install(pack: ByteArray, pin: Pin = pinOf(pack), name: String = "python", fetch: (String) -> InputStream = { ByteArrayInputStream(pack) }): String =
        runBlocking { LanguagePacks.install(dir, name, fetch, { _, _ -> }, pin) }

    private fun assertNothingWritten() = assertEquals(emptyList<String>(), dir.list()!!.toList())

    @Test fun aGoodPackInstallsAndReportsInstalled() {
        assertEquals("ok", install(gz(zip(good()))))
        val state = LanguagePacks.state(dir, "python")
        assertEquals(true, state["installe"])
        assertEquals("1.0.0", state["version"])
        assertTrue((state["octets"] as Long) > 0)
        // The payload is the original BYTES, not the UTF-8 wrapping.
        assertArrayEquals(binary, File(dir, "python/pyodide.asm.wasm").readBytes())
        assertEquals("a", File(dir, "python/sub/dir/a.txt").readText())
        assertEquals(listOf("python"), dir.list()!!.toList())
        assertTrue(LanguagePacks.installedVersion(dir, "python") == "1.0.0")
    }

    @Test fun aWrongHashIsRefusedAndNothingIsWritten() {
        val pack = gz(zip(good()))
        assertEquals("empreinte", install(pack, pinOf(pack).copy(sha256 = "0".repeat(64))))
        assertNothingWritten()
    }

    @Test fun aSameSizeBodyOfAnotherContentIsRefused() {
        val pack = gz(zip(good()))
        val other = pack.clone().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
        assertEquals("empreinte", install(pack, pinOf(pack)) { ByteArrayInputStream(other) })
        assertNothingWritten()
    }

    @Test fun aBodyLongerThanThePinIsRefusedAndCutShort() {
        val pack = gz(zip(good()))
        var read = 0L
        val endless = object : InputStream() {
            override fun read(): Int { read++; return 7 }
            override fun read(b: ByteArray, off: Int, len: Int): Int { read += len; b.fill(7, off, off + len); return len }
        }
        assertEquals("empreinte", install(pack, pinOf(pack)) { endless })
        assertTrue("read $read bytes of an endless body", read < pack.size + 200_000)
        assertNothingWritten()
    }

    @Test fun aTruncatedBodyIsRefused() {
        val pack = gz(zip(good()))
        assertEquals("empreinte", install(pack, pinOf(pack)) { ByteArrayInputStream(pack.copyOf(pack.size - 5)) })
        assertNothingWritten()
    }

    @Test fun aCorruptArchiveAtTheRightHashIsRefused() {
        assertEquals("empreinte", install("this is not a gzip stream".toByteArray()))
        assertNothingWritten()
    }

    @Test fun unsafeEntryNamesAreRefusedEvenInAPackAtTheRightHash() {
        for (bad in listOf("../x", "C:x", "C:/x", "/x", "a\\x", "a\\..\\x", "\\\\server\\share\\x", "a//b", "./x", "a/./b", "a/../b", "a\u0000b")) {
            val pack = gz(zip(listOf("manifest.json" to "{}".toByteArray(), bad to "evil".toByteArray())))
            assertEquals("entry " + bad.replace("\u0000", "<NUL>"), "empreinte", install(pack))
            assertNothingWritten()
            assertEquals(listOf("languages"), base.list()!!.toList())
        }
    }

    @Test fun anEmptyEntryNameIsRefused() {
        assertEquals("empreinte", install(gz(zip(listOf("" to "evil".toByteArray())))))
        assertNothingWritten()
    }

    @Test fun theEntryRuleMatchesNomEntreeAdmis() {
        for (bad in listOf("", "../x", "a/../x", "C:x", "c:\\x", "/x", "a\\x", "a//b", ".", "..", "a/.", "a\u0000b")) assertNull(bad, LanguagePacks.entryNameAllowed(bad))
        for (ok in listOf("clang/bundle.js", "manifest.json", "a.b/c-d_e")) assertEquals(ok, LanguagePacks.entryNameAllowed(ok))
    }

    @Test fun aFailedReinstallKeepsThePreviousPack() {
        assertEquals("ok", install(gz(zip(good()))))
        val bad = gz(zip(listOf("manifest.json" to """{"version":"2"}""".toByteArray(), "../x" to "e".toByteArray())))
        assertEquals("empreinte", install(bad))
        assertEquals("1.0.0", LanguagePacks.state(dir, "python")["version"])
        assertEquals(listOf("python"), dir.list()!!.toList())
    }

    @Test fun anUnreachableReleaseIsANetworkFailure() {
        val pack = gz(zip(good()))
        assertEquals("reseau", install(pack, pinOf(pack)) { throw IOException("down") })
        assertNothingWritten()
    }

    @Test fun anUnknownPackIsNeverInstalled() {
        assertEquals("reseau", install(gz(zip(good())), name = "../evil"))
        assertNothingWritten()
    }

    @Test fun deleteRemovesOnlyThatPack() {
        val pack = gz(zip(good()))
        assertEquals("ok", install(pack, name = "python"))
        assertEquals("ok", install(pack, name = "c"))
        LanguagePacks.delete(dir, "python")
        assertEquals(false, LanguagePacks.state(dir, "python")["installe"])
        assertFalse(File(dir, "python").exists())
        assertEquals(true, LanguagePacks.state(dir, "c")["installe"])
        assertTrue(File(dir, "c/pyodide.asm.wasm").isFile)
        LanguagePacks.delete(dir, "../c")
        assertEquals(true, LanguagePacks.state(dir, "c")["installe"])
    }

    @Test fun stateOfAnAbsentOrMalformedManifestIsNotInstalled() {
        assertEquals(false, LanguagePacks.state(dir, "c")["installe"])
        File(dir, "c").mkdirs()
        File(dir, "c/manifest.json").writeText("not json")
        assertEquals(false, LanguagePacks.state(dir, "c")["installe"])
        File(dir, "c/manifest.json").writeText("""{"version":3}""")
        assertEquals(false, LanguagePacks.state(dir, "c")["installe"])
    }

    @Test fun theKotlinPinsAreWellFormed() {
        for ((name, pin) in LanguagePacks.PINS) {
            assertTrue(name, Regex("^[0-9a-f]{64}$").matches(pin.sha256))
            assertTrue(name, LanguagePacks.urlAllowed(pin.url))
            assertTrue(name, pin.size > 0)
        }
        assertEquals(setOf("c", "python"), LanguagePacks.PINS.keys)
    }

    // ---- the network rules -------------------------------------------------

    @Test fun onlyHttpsOnTheThreeHostsIsAllowed() {
        for (ok in listOf("https://github.com/a", "https://objects.githubusercontent.com/a", "https://release-assets.githubusercontent.com/a?x=1", "https://GitHub.com/a")) assertTrue(ok, LanguagePacks.urlAllowed(ok))
        for (bad in listOf("http://github.com/a", "https://evil.com/a", "https://github.com.evil.com/a", "https://user@github.com/a", "https://github.com:8443/a", "ftp://github.com/a", "https://githubusercontent.com/a", "not a url", "")) assertFalse(bad, LanguagePacks.urlAllowed(bad))
    }

    private fun hop(status: Int, location: String? = null, body: String? = null) =
        LanguagePacks.Hop(status, location, body?.let { ByteArrayInputStream(it.toByteArray()) })

    @Test fun redirectsAreFollowedByHandAndEveryHopIsRejudged() {
        val seen = ArrayList<String>()
        val stream = LanguagePacks.follow("https://github.com/a") { u ->
            seen.add(u)
            if (u.startsWith("https://github.com")) hop(302, "https://release-assets.githubusercontent.com/b") else hop(200, body = "pack")
        }
        assertEquals("pack", stream.readBytes().toString(Charsets.UTF_8))
        assertEquals(listOf("https://github.com/a", "https://release-assets.githubusercontent.com/b"), seen)
    }

    @Test fun aRedirectOutsideTheListIsNeverRequested() {
        for (target in listOf("https://evil.com/x", "http://github.com/x", "https://github.com:81/x")) {
            val seen = ArrayList<String>()
            assertThrows(IOException::class.java) { LanguagePacks.follow("https://github.com/a") { u -> seen.add(u); hop(302, target) } }
            assertEquals(listOf("https://github.com/a"), seen)
        }
    }

    @Test fun aFirstUrlOutsideTheListIsNeverRequested() {
        var requested = false
        assertThrows(IOException::class.java) { LanguagePacks.follow("https://evil.com/a") { requested = true; hop(200, body = "x") } }
        assertFalse(requested)
    }

    @Test fun relativeRedirectsResolveAgainstTheCurrentUrlAndTooManyHopsStop() {
        val seen = ArrayList<String>()
        assertThrows(IOException::class.java) { LanguagePacks.follow("https://github.com/a") { u -> seen.add(u); hop(301, "/loop") } }
        assertEquals(LanguagePacks.MAX_HOPS, seen.size)
        assertEquals("https://github.com/loop", seen[1])
    }

    @Test fun aRedirectWithoutDestinationAndAnHttpErrorFail() {
        assertThrows(IOException::class.java) { LanguagePacks.follow("https://github.com/a") { hop(302) } }
        assertThrows(IOException::class.java) { LanguagePacks.follow("https://github.com/a") { hop(404) } }
    }

    @Test fun aDownloadPastItsOverallDeadlineIsAbandonedAndNothingIsWritten() {
        val pack = gz(zip(good()))
        // An immediate deadline: the first chunk read is already late (a drip-feeding host is cut the same way).
        val r = runBlocking { LanguagePacks.install(dir, "python", { ByteArrayInputStream(pack) }, { _, _ -> }, pinOf(pack), deadlineMs = -1) }
        assertEquals("reseau", r)
        assertNothingWritten()
    }

    @Test fun anOutOfMemoryErrorIsACleanAnswerAndNothingIsWritten() {
        val pack = gz(zip(good()))
        val boom = object : InputStream() {
            override fun read(): Int = throw OutOfMemoryError("test")
            override fun read(b: ByteArray, off: Int, len: Int): Int = throw OutOfMemoryError("test")
        }
        assertEquals("reseau", install(pack, pinOf(pack)) { boom })
        assertNothingWritten()
    }

    @Test fun everyRequestAsksForTheIdentityEncoding() {
        // HttpsURLConnection cannot be faked here, so the header is tied to the source.
        val src = File("src/main/java/com/ahmedmili/neoquiz/code/LanguagePacks.kt").readText()
        assertTrue(src.contains("setRequestProperty(\"Accept-Encoding\", \"identity\")"))
    }
}
