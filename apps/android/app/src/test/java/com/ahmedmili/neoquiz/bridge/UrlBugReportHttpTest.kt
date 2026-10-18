package com.ahmedmili.neoquiz.bridge

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/**
 * The real transport against a fake loopback server (JDK `HttpServer`, never the network): a
 * redirect is refused, never followed, and the answer is capped at exactly `RESPONSE_MAX_BYTES`.
 */
class UrlBugReportHttpTest {
    private lateinit var server: HttpServer
    private val seen = CopyOnWriteArrayList<String>()
    private var status = 200
    private var reply: ByteArray = "{}".toByteArray()

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/") { ex: HttpExchange ->
            seen.add(ex.requestURI.toString())
            if (status in 300..399) ex.responseHeaders.add("Location", "http://localhost:${server.address.port}/followed")
            ex.sendResponseHeaders(status, if (reply.isEmpty()) -1L else reply.size.toLong())
            if (reply.isNotEmpty()) ex.responseBody.use { it.write(reply) }
            ex.close()
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    private fun url() = "http://localhost:${server.address.port}/report"

    @Test fun `a redirect is refused, never followed`() {
        status = 302
        val e = assertThrows(IOException::class.java) {
            UrlBugReportHttp().request("POST", url(), mapOf("Accept" to "application/json"), "{}")
        }
        assertEquals("redirect refused", e.message)
        assertEquals(listOf("/report"), seen.toList())
    }

    @Test fun `the answer is capped at 64 KB`() {
        val head = "{\"pad\":\""
        val tail = "\"}"
        fun body(n: Int) = (head + "a".repeat(n) + tail).toByteArray(Charsets.UTF_8)
        assertEquals(BugReportRules.RESPONSE_MAX_BYTES, body(65526).size)
        reply = body(65526)
        assertEquals(65526, UrlBugReportHttp().request("GET", url(), emptyMap(), null).getString("pad").length)
        reply = body(65527)
        val e = assertThrows(IOException::class.java) { UrlBugReportHttp().request("GET", url(), emptyMap(), null) }
        assertEquals("answer too large", e.message)
    }
}