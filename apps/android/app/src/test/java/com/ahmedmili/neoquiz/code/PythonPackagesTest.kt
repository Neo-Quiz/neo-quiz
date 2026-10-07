package com.ahmedmili.neoquiz.code

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PythonPackagesTest {
    private lateinit var packDir: File
    private val cdn = PythonPackages.cdnBase("1.0.0")

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private val numpy = "numpy-1.0-cp312-cp312-pyodide_2024_0_wasm32.whl".toByteArray()

    @Before
    fun setUp() {
        packDir = Files.createTempDirectory("python").toFile().canonicalFile
        File(packDir, "manifest.json").writeText("""{"version":"1.0.0"}""")
        writeLock(mapOf("numpy-1.0.whl" to sha(numpy)))
    }

    private fun writeLock(files: Map<String, String>) {
        val pk = JSONObject()
        files.entries.forEachIndexed { i, (name, digest) -> pk.put("p$i", JSONObject().put("file_name", name).put("sha256", digest)) }
        File(packDir, "pyodide-lock.json").writeText(JSONObject().put("packages", pk).toString())
    }

    /** A transport that records every URL and answers from a map; an unknown URL is refused like a host outside the list. */
    private class Net(val answers: Map<String, ByteArray>) : PythonPackages.Fetch {
        val seen = ArrayList<String>()
        override fun open(url: String, accept: String?): InputStream {
            seen.add(url)
            return ByteArrayInputStream(answers[url] ?: throw IOException("refused $url"))
        }
    }

    private fun cache() = File(packDir, "paquets").list()?.toList() ?: emptyList()

    // ---- pure rules -------------------------------------------------------

    @Test fun lockEntryNamesOnlyTheExactFile() {
        val lock = JSONObject(File(packDir, "pyodide-lock.json").readText())
        assertEquals(sha(numpy), PythonPackages.lockEntry(lock, "numpy-1.0.whl"))
        assertNull(PythonPackages.lockEntry(lock, "numpy-1.0.whl.exe"))
        assertNull(PythonPackages.lockEntry(lock, "../numpy-1.0.whl"))
        assertNull(PythonPackages.lockEntry(null, "numpy-1.0.whl"))
        val bad = JSONObject().put("packages", JSONObject().put("x", JSONObject().put("file_name", "a.whl").put("sha256", "nothex")))
        assertNull(PythonPackages.lockEntry(bad, "a.whl"))
    }

    @Test fun pypiUrlAcceptsOnlyTheTwoShapes() {
        assertEquals("https://pypi.org/simple/requests/", PythonPackages.pypiUrl("simple/requests/"))
        assertEquals("https://files.pythonhosted.org/packages/ab/cd/x-1.0-py3-none-any.whl", PythonPackages.pypiUrl("files/packages/ab/cd/x-1.0-py3-none-any.whl"))
        for (bad in listOf("simple/../x/", "simple/a/b/", "simple/a", "files/../x", "files/a/../b", "files/", "files/a//b", "other/x", "simple/-a/", "files/a/.b", "", "files/a\\b")) {
            assertNull(bad, PythonPackages.pypiUrl(bad))
        }
    }

    @Test fun onlyPureWheelsAreAllowed() {
        for (ok in listOf("x-1.0-py3-none-any.whl", "x-1.0-py2.py3-none-any.whl", "x-1.0-cp312-cp312-pyodide_2024_0_wasm32.whl")) assertTrue(ok, PythonPackages.wheelAllowed(ok))
        for (bad in listOf("x-1.0-cp312-cp312-manylinux_2_17_x86_64.whl", "x-1.0.tar.gz", "x-1.0-py3-none-any.zip", "x-1.0-win_amd64.whl")) assertFalse(bad, PythonPackages.wheelAllowed(bad))
    }

    @Test fun hostPredicateIsExactlyTheThreePackageHostsOverHttps() {
        for (ok in listOf("https://cdn.jsdelivr.net/a", "https://pypi.org/simple/x/", "https://files.pythonhosted.org/a", "https://PyPI.org/a")) assertTrue(ok, PythonPackages.hostAllowed(ok))
        for (bad in listOf("http://pypi.org/a", "https://github.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://pypi.org.evil.com/a", "https://evil.com/pypi.org", "https://user@pypi.org/a", "https://pypi.org:8443/a", "https://objects.githubusercontent.com/a", "nope", "")) assertFalse(bad, PythonPackages.hostAllowed(bad))
    }

    @Test fun theBudgetRefusesWhatDoesNotFitAndSpendsNothing() {
        val b = PythonPackages.Budget(10)
        assertTrue(b.take(6))
        assertFalse(b.take(5))
        assertTrue(b.take(4))
        assertFalse(b.take(1))
        assertFalse(PythonPackages.Budget(10).take(-1))
    }

    @Test fun theSandboxPathOfTheProxyIsSameOriginAndDecoded() {
        val h = CodeProtocol.ORIGIN
        assertEquals("simple/requests/", CodeProtocol.pypiPathFor("$h/pypi/simple/requests/"))
        assertEquals("files/a/x-1.0+l-py3-none-any.whl", CodeProtocol.pypiPathFor("$h/pypi/files/a/x-1.0%2Bl-py3-none-any.whl"))
        for (bad in listOf("https://evil.com/pypi/simple/x/", "http://${CodeProtocol.HOST}/pypi/simple/x/", "$h:8443/pypi/x", "https://u@${CodeProtocol.HOST}/pypi/x", "$h/other/pypi/x", "$h/pypi")) assertNull(bad, CodeProtocol.pypiPathFor(bad))
    }

    // ---- Pyodide packages -------------------------------------------------

    @Test fun aFileTheLockDoesNotNameIs404AndNoRequestLeaves() {
        val net = Net(emptyMap())
        for (f in listOf("evil.whl", "..", "a/b", "numpy-1.0.whl.part", "")) assertEquals(f, 404, PythonPackages.servePackage(packDir, f, net, cdn).status)
        assertTrue(net.seen.isEmpty())
        assertEquals(emptyList<String>(), cache())
    }

    @Test fun aListedFileIsDownloadedHashCheckedCachedThenServedFromTheCache() {
        val net = Net(mapOf(cdn + "numpy-1.0.whl" to numpy))
        val r = PythonPackages.servePackage(packDir, "numpy-1.0.whl", net, cdn)
        assertEquals(200, r.status)
        assertEquals(String(numpy), String(r.body))
        assertEquals(listOf("numpy-1.0.whl"), cache())
        assertEquals(200, PythonPackages.servePackage(packDir, "numpy-1.0.whl", net, cdn).status)
        assertEquals(1, net.seen.size)
    }

    @Test fun aHashMismatchLeavesNothingOnDisk() {
        val net = Net(mapOf(cdn + "numpy-1.0.whl" to "tampered".toByteArray()))
        assertEquals(502, PythonPackages.servePackage(packDir, "numpy-1.0.whl", net, cdn).status)
        assertEquals(emptyList<String>(), cache())
    }

    @Test fun aTamperedCacheEntryIsDroppedAndDownloadedAgain() {
        File(packDir, "paquets").mkdirs()
        File(packDir, "paquets/numpy-1.0.whl").writeText("poisoned")
        val net = Net(mapOf(cdn + "numpy-1.0.whl" to numpy))
        val r = PythonPackages.servePackage(packDir, "numpy-1.0.whl", net, cdn)
        assertEquals(String(numpy), String(r.body))
        assertEquals(1, net.seen.size)
    }

    @Test fun aFileOverTheCapAndAnExhaustedBudgetAreRefusedWritingNothing() {
        writeLock(mapOf("big.whl" to sha(ByteArray(2048))))
        // The cap is a constant (50 MB): an endless body is cut at it; a small budget cuts earlier.
        val endless = PythonPackages.Fetch { _, _ ->
            object : InputStream() {
                override fun read(): Int = 7
                override fun read(b: ByteArray, off: Int, len: Int): Int { b.fill(7, off, off + len); return len }
            }
        }
        assertEquals(503, PythonPackages.servePackage(packDir, "big.whl", endless, cdn, PythonPackages.Budget(1000)).status)
        assertEquals(502, PythonPackages.servePackage(packDir, "big.whl", endless, cdn, PythonPackages.Budget(PythonPackages.MAX_BUDGET * 2)).status)
        assertEquals(emptyList<String>(), cache())
    }

    @Test fun aDownloadPastItsDeadlineAndAnOutOfMemoryAre503WritingNothing() {
        val net = Net(mapOf(cdn + "numpy-1.0.whl" to numpy))
        assertEquals(503, PythonPackages.servePackage(packDir, "numpy-1.0.whl", net, cdn, deadlineMs = -1).status)
        val oom = PythonPackages.Fetch { _, _ -> throw OutOfMemoryError("test") }
        assertEquals(503, PythonPackages.servePackage(packDir, "numpy-1.0.whl", oom, cdn).status)
        assertEquals(emptyList<String>(), cache())
    }

    @Test fun aPackDeletedDuringTheDownloadIsNotRecreated() {
        val deleting = PythonPackages.Fetch { _, _ ->
            File(packDir, "manifest.json").delete()
            ByteArrayInputStream(numpy)
        }
        assertEquals(503, PythonPackages.servePackage(packDir, "numpy-1.0.whl", deleting, cdn).status)
        assertFalse(File(packDir, "paquets").exists())
    }

    @Test fun aRedirectToAnotherHostIsNeverRequested() {
        val seen = ArrayList<String>()
        val fetch = PythonPackages.Fetch { url, _ ->
            LanguagePacks.follow(url, PythonPackages::hostAllowed) { u ->
                seen.add(u)
                if (u.startsWith("https://cdn.jsdelivr.net")) LanguagePacks.Hop(302, "https://github.com/x", null) else LanguagePacks.Hop(200, null, ByteArrayInputStream(numpy))
            }
        }
        assertEquals(503, PythonPackages.servePackage(packDir, "numpy-1.0.whl", fetch, cdn).status)
        assertEquals(listOf(cdn + "numpy-1.0.whl"), seen)
        assertEquals(emptyList<String>(), cache())
    }

    // ---- PyPI -------------------------------------------------------------

    private val wheel = "pure wheel bytes".toByteArray()
    private val wheelUrl = "https://files.pythonhosted.org/packages/aa/bb/pkg-1.0-py3-none-any.whl"
    private val nativeUrl = "https://files.pythonhosted.org/packages/aa/bb/pkg-1.0-cp312-cp312-manylinux_2_17_x86_64.whl"
    private val wheelPath = "files/packages/aa/bb/pkg-1.0-py3-none-any.whl"

    private fun index(): ByteArray {
        fun file(url: String, digest: String?) = JSONObject().put("url", url).put("filename", url.substringAfterLast('/'))
            .put("core-metadata", true).put("hashes", JSONObject().also { if (digest != null) it.put("sha256", digest) })
        return JSONObject().put("name", "pkg").put(
            "files",
            JSONArray()
                .put(file(wheelUrl, sha(wheel)))
                .put(file(nativeUrl, sha(wheel)))
                .put(file("https://evil.com/x-1.0-py3-none-any.whl", sha(wheel)))
                .put(file("https://files.pythonhosted.org/packages/x-2.0-py3-none-any.whl", null)),
        ).toString().toByteArray()
    }

    private fun pypiNet() = Net(mapOf("https://pypi.org/simple/pkg/" to index(), wheelUrl to wheel))

    @Test fun theIndexKeepsOnlyPureHashedWheelsPointedBackAtTheProxy() {
        val r = PythonPackages.servePypi("simple/pkg/", PythonPackages.Session(), pypiNet(), packDir)
        assertEquals(200, r.status)
        val files = JSONObject(String(r.body)).getJSONArray("files")
        assertEquals(1, files.length())
        assertEquals("file:///pypi/files/packages/aa/bb/pkg-1.0-py3-none-any.whl", files.getJSONObject(0).getString("url"))
        assertFalse(files.getJSONObject(0).has("core-metadata"))
    }

    @Test fun aWheelIsServedOnlyIfItsBytesMatchTheDigestTheIndexAnnounced() {
        val s = PythonPackages.Session()
        val net = pypiNet()
        // Before the index announced it: refused, no request.
        assertEquals(403, PythonPackages.servePypi(wheelPath, s, net, packDir).status)
        assertFalse(net.seen.contains(wheelUrl))
        PythonPackages.servePypi("simple/pkg/", s, net, packDir)
        val r = PythonPackages.servePypi(wheelPath, s, net, packDir)
        assertEquals(200, r.status)
        assertEquals(String(wheel), String(r.body))
        assertEquals(listOf("pypi-${sha(wheel)}.whl"), cache())
        // Content-addressed cache: asked twice, downloaded once. The native wheel was never announced.
        PythonPackages.servePypi(wheelPath, s, net, packDir)
        assertEquals(1, net.seen.count { it == wheelUrl })
        assertEquals(403, PythonPackages.servePypi("files/packages/aa/bb/pkg-1.0-cp312-cp312-manylinux_2_17_x86_64.whl", s, net, packDir).status)
    }

    @Test fun aWheelWithOtherBytesThanAnnouncedIs403AndWritesNothing() {
        val s = PythonPackages.Session()
        val net = Net(mapOf("https://pypi.org/simple/pkg/" to index(), wheelUrl to "other".toByteArray()))
        PythonPackages.servePypi("simple/pkg/", s, net, packDir)
        assertEquals(403, PythonPackages.servePypi(wheelPath, s, net, packDir).status)
        assertEquals(emptyList<String>(), cache())
    }

    @Test fun theIndexIsFetchedOnceAndABadPathIs403() {
        val s = PythonPackages.Session()
        val net = pypiNet()
        PythonPackages.servePypi("simple/pkg/", s, net, packDir)
        PythonPackages.servePypi("simple/pkg/", s, net, packDir)
        assertEquals(1, net.seen.count { it == "https://pypi.org/simple/pkg/" })
        assertEquals(403, PythonPackages.servePypi("files/../etc/passwd", s, net, packDir).status)
        assertEquals(403, PythonPackages.servePypi("simple/a/b/", s, net, packDir).status)
    }

    @Test fun anIndexThatIsNotJsonOrHasNoFilesIs502() {
        val s = PythonPackages.Session()
        assertEquals(502, PythonPackages.servePypi("simple/pkg/", s, Net(mapOf("https://pypi.org/simple/pkg/" to "<html>".toByteArray())), packDir).status)
        assertEquals(502, PythonPackages.servePypi("simple/pkg/", s, Net(mapOf("https://pypi.org/simple/pkg/" to "{}".toByteArray())), packDir).status)
    }

    @Test fun aWheelDownloadedAfterThePackWasDeletedIsNotCached() {
        val s = PythonPackages.Session()
        val net = pypiNet()
        PythonPackages.servePypi("simple/pkg/", s, net, packDir)
        File(packDir, "manifest.json").delete()
        assertEquals(503, PythonPackages.servePypi(wheelPath, s, net, packDir).status)
        assertFalse(File(packDir, "paquets").exists())
    }
}
