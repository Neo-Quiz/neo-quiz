package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

class ResourceRouteTest {
    private lateinit var base: File
    private lateinit var root: File
    private lateinit var perimeter: Perimeter

    private val origin = "https://${UrlPolicy.HOST}"

    @Before fun setUp() {
        base = Files.createTempDirectory("res").toFile()
        root = File(base, "Neo Quiz").also { it.mkdirs() }
        File(root, "ok.png").writeBytes(byteArrayOf(1, 2, 3))
        File(root, "sub").mkdirs()
        File(root, "sub/mon schéma #1.PNG").writeBytes(byteArrayOf(4))
        File(root, "pic.svg").writeText("<svg/>")
        File(root, "evil.apk").writeBytes(byteArrayOf(5))
        File(root, "page.html").writeText("<script>alert(1)</script>")
        File(root, "note.txt").writeText("x")
        File(root, "noext").writeText("x")
        File(root, "dir.png").mkdirs()
        File(base, "outside").mkdirs()
        File(base, "outside/secret.png").writeBytes(byteArrayOf(9))
        perimeter = Perimeter({ listOf(root) }, File(base, "private"))
    }

    /** The URL the Android shim builds for an absolute path (segments encoded, `/` kept). */
    private fun urlOf(abs: String): String {
        val segments = abs.replace(java.io.File.separatorChar, '/').split('/').joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20").replace("%3A", ":") }
        return "$origin/neo-res/$segments"
    }

    private fun resolve(url: String) = ResourceRoute.resolve(url, perimeter)

    @Test fun anImageInsideARootIsServedWithItsMime() {
        val r = resolve(urlOf(File(root, "ok.png").path))
        assertNotNull(r)
        assertEquals("image/png", r!!.mime)
        assertEquals(File(root, "ok.png").canonicalFile, r.file.canonicalFile)
    }

    @Test fun spacesHashAccentsAndUpperCaseExtensionsAreDecoded() {
        val r = resolve(urlOf(File(root, "sub/mon schéma #1.PNG").path))
        assertEquals("image/png", r?.mime)
    }

    @Test fun svgIsServedAsAnImageOnly() {
        assertEquals("image/svg+xml", resolve(urlOf(File(root, "pic.svg").path))?.mime)
    }

    @Test fun executablesDocumentsAndUnknownTypesAreRefused() {
        for (name in listOf("evil.apk", "page.html", "note.txt", "noext")) assertNull(name, resolve(urlOf(File(root, name).path)))
    }

    @Test fun aPathOutsideEveryRootIsRefused() {
        assertNull(resolve(urlOf(File(base, "outside/secret.png").path)))
    }

    @Test fun dotDotIsRefusedPlainOrEncoded() {
        val inside = urlOf(File(root, "ok.png").path)
        val parent = urlOf(root.path)
        assertNull(resolve("$parent/../outside/secret.png"))
        assertNull(resolve("$parent/%2e%2e/outside/secret.png"))
        assertNull(resolve("$parent/%2E%2E/outside/secret.png"))
        assertNull(resolve("$parent/sub/..%2f..%2foutside/secret.png"))
        assertNotNull(resolve(inside))
    }

    @Test fun aDirectoryWithAnImageNameIsRefused() {
        assertNull(resolve(urlOf(File(root, "dir.png").path)))
    }

    @Test fun aMissingFileAndANulByteAreRefused() {
        assertNull(resolve(urlOf(File(root, "missing.png").path)))
        assertNull(resolve(urlOf(File(root, "ok.png").path) + "%00.png"))
    }

    @Test fun onlyTheAppsOwnHttpsOriginAndTheResourcePrefixAreRoutes() {
        val path = urlOf(File(root, "ok.png").path).substringAfter("/neo-res/")
        assertNull(resolve("http://${UrlPolicy.HOST}/neo-res/$path"))
        assertNull(resolve("https://evil.example/neo-res/$path"))
        assertNull(resolve("https://${UrlPolicy.HOST}.evil.example/neo-res/$path"))
        assertNull(resolve("https://u@${UrlPolicy.HOST}/neo-res/$path"))
        assertNull(resolve("$origin/assets/$path"))
        assertTrue(ResourceRoute.isResourceUrl("$origin/neo-res/$path"))
        assertFalse(ResourceRoute.isResourceUrl("$origin/assets/web/index.html"))
    }

    @Test fun everyResponseIsAnInertDocument() {
        val png = resolve(urlOf(File(root, "ok.png").path))
        val svg = resolve(urlOf(File(root, "pic.svg").path))
        for (served in listOf(png, svg, null)) {
            val h = ResourceRoute.responseHeaders(served)
            assertEquals("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", h["Content-Security-Policy"])
            assertEquals("nosniff", h["X-Content-Type-Options"])
        }
    }

    @Test fun aSymlinkToANonImageIsRefused() {
        val link = File(root, "innocent.png")
        try {
            Files.createSymbolicLink(link.toPath(), File(root, "evil.apk").toPath())
        } catch (_: Exception) {
            assumeTrue("symlinks unavailable here", false)
        }
        assertNull(resolve(urlOf(link.path)))
    }
}
