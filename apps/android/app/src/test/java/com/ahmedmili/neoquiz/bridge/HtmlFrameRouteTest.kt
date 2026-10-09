package com.ahmedmili.neoquiz.bridge

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class HtmlFrameRouteTest {
    private val origin = "https://${UrlPolicy.HOST}"
    private var clock = 1_000L
    private var counter = 0
    private fun store() = HtmlFrameStore({ clock }, { "%032x".format(++counter) })
    private fun url(path: String) = origin + path

    @Test fun `the response carries the exact frame CSP and the sandbox`() {
        val s = store()
        val path = s.publish("<p>x</p>")!!
        val r = HtmlFrameStore.respond(s, url(path), "GET", false)
        assertEquals(200, r.status)
        assertEquals(
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
                "media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
            r.headers["Content-Security-Policy"],
        )
        assertFalse(r.headers["Content-Security-Policy"]!!.contains("allow-same-origin"))
        assertEquals("nosniff", r.headers["X-Content-Type-Options"])
        assertEquals("no-store", r.headers["Cache-Control"])
        assertEquals("<p>x</p>", String(r.body, Charsets.UTF_8))
    }

    @Test fun `the CSP of the app itself is untouched by the frame CSP`() {
        assertTrue(UrlPolicy.CSP.contains("script-src 'self';"))
        assertFalse(UrlPolicy.CSP.contains("unsafe-inline'; connect"))
        assertFalse(UrlPolicy.CSP.contains("script-src 'unsafe-inline'"))
    }

    @Test fun `a document is served once`() {
        val s = store()
        val path = s.publish("<p>x</p>")!!
        assertEquals(200, HtmlFrameStore.respond(s, url(path), "GET", false).status)
        assertEquals(404, HtmlFrameStore.respond(s, url(path), "GET", false).status)
        assertEquals(0, s.size())
    }

    @Test fun `an unknown or malformed id is 404`() {
        val s = store()
        assertEquals(404, HtmlFrameStore.respond(s, url("/__frame/" + "a".repeat(32)), "GET", false).status)
        for (bad in listOf("/__frame/", "/__frame/zz", "/__frame/" + "A".repeat(32), "/__frame/" + "a".repeat(33), "/__frame/../x", "/__frame/" + "a".repeat(32) + "/x")) {
            assertEquals(bad, 404, HtmlFrameStore.respond(s, url(bad), "GET", false).status)
        }
    }

    @Test fun `only a sub-frame GET is served`() {
        val s = store()
        val path = s.publish("<p>x</p>")!!
        assertEquals(403, HtmlFrameStore.respond(s, url(path), "GET", true).status)
        assertEquals(403, HtmlFrameStore.respond(s, url(path), "POST", false).status)
        // The refused requests did not consume it.
        assertEquals(200, HtmlFrameStore.respond(s, url(path), "GET", false).status)
    }

    @Test fun `a query, a fragment, another host or a port is never served`() {
        val s = store()
        val path = s.publish("<p>x</p>")!!
        for (u in listOf(url("$path?a=1"), url("$path#f"), "https://evil.example$path", "http://${UrlPolicy.HOST}$path", "https://${UrlPolicy.HOST}:8443$path")) {
            assertEquals(u, 404, HtmlFrameStore.respond(s, u, "GET", false).status)
        }
        assertEquals(200, HtmlFrameStore.respond(s, url(path), "GET", false).status)
    }

    @Test fun `the size is bounded`() {
        val s = store()
        assertNotNull(s.publish("x".repeat(HtmlFrameStore.MAX_BYTES)))
        assertNull(s.publish("x".repeat(HtmlFrameStore.MAX_BYTES + 1)))
        // Bytes, not characters: a 3-byte character.
        assertNull(s.publish("€".repeat(HtmlFrameStore.MAX_BYTES / 3 + 1)))
        assertNull(s.publish("   "))
        assertEquals(216 * 1024, HtmlFrameStore.MAX_BYTES)
    }

    @Test fun `the number of documents is bounded and the oldest goes first`() {
        val s = store()
        val first = s.publish("first")!!
        repeat(HtmlFrameStore.MAX_ENTRIES) { s.publish("d$it") }
        assertEquals(HtmlFrameStore.MAX_ENTRIES, s.size())
        assertEquals(404, HtmlFrameStore.respond(s, url(first), "GET", false).status)
    }

    @Test fun `a document expires`() {
        val s = store()
        val path = s.publish("<p>x</p>")!!
        clock += HtmlFrameStore.TTL_MS
        assertEquals(404, HtmlFrameStore.respond(s, url(path), "GET", false).status)
        assertEquals(0, s.size())
    }

    @Test fun `ids are 128 bits of randomness`() {
        val a = HtmlFrameStore.randomId()
        assertTrue(Regex("^[0-9a-f]{32}$").matches(a))
        assertTrue(a != HtmlFrameStore.randomId())
    }

    @Test fun `the channel publishes and refuses a non-string`() {
        val s = store()
        val ch = HtmlFrameChannel(s)
        assertEquals(setOf("android.publierCadre"), ch.handlers().keys)
        val path = ch.publish(JSONArray().put("<p>x</p>"))!!
        assertTrue(Regex("^/__frame/[0-9a-f]{32}$").matches(path))
        assertNull(ch.publish(JSONArray().put("")))
        assertThrows(IllegalArgumentException::class.java) { ch.publish(JSONArray().put(42)) }
        assertThrows(IllegalArgumentException::class.java) { ch.publish(JSONArray()) }
    }

    @Test fun `every frame url is claimed by the route`() {
        assertTrue(HtmlFrameStore.isFrameUrl(url("/__frame/whatever?x")))
        assertFalse(HtmlFrameStore.isFrameUrl(url("/assets/web/index.html")))
        assertFalse(HtmlFrameStore.isFrameUrl("https://evil.example/__frame/x"))
    }
}
