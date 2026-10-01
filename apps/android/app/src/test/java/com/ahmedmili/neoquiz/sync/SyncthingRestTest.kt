package com.ahmedmili.neoquiz.sync

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The REST client against a fake server (JDK `HttpServer`): the key header, the status check, the path guards. */
class SyncthingRestTest {
    private class Seen(val method: String, val path: String, val key: String?, val body: String)

    private lateinit var server: HttpServer
    private val seen = CopyOnWriteArrayList<Seen>()
    private val key = "cd".repeat(32)
    private var status = 200
    private var reply = "{}"
    private val id = "CJXCUH3-SLWCMGX-7FKY3GZ-TAJCUWC-V5GKRYB-3APQ7CN-LPPVSJS-OZLDAQJ"

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/") { ex: HttpExchange ->
            seen.add(Seen(ex.requestMethod, ex.requestURI.toString(), ex.requestHeaders.getFirst("X-API-Key"), ex.requestBody.readBytes().toString(Charsets.UTF_8)))
            val bytes = reply.toByteArray()
            ex.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) ex.responseBody.use { it.write(bytes) }
            ex.close()
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    private fun rest() = SyncthingRest(server.address.port, key)

    @Test fun everyCallSendsTheKey() {
        reply = """{"myID":"$id"}"""
        val r = rest()
        assertEquals(id, r.myId())
        r.ping()
        reply = "[]"
        r.devices()
        r.events(7, listOf("StateChanged", "ItemFinished"))
        assertTrue(seen.size == 4)
        assertTrue(seen.all { it.key == key })
        assertEquals("/rest/events?since=7&timeout=1&events=StateChanged%2CItemFinished", seen[3].path)
    }

    @Test fun aNon2xxStatusThrows() {
        status = 403
        val e = assertThrows(java.io.IOException::class.java) { rest().ping() }
        assertTrue(e.message!!.contains("403"))
        status = 500
        assertThrows(java.io.IOException::class.java) { rest().myId() }
    }

    @Test fun aWrongKeyIsWhatTheServerRefuses() {
        // The fake only checks what the client sent: a client built with another key sends THAT key.
        SyncthingRest(server.address.port, "ef".repeat(32)).ping()
        assertEquals("ef".repeat(32), seen.last().key)
    }

    @Test fun putFolderSendsJsonAndTheIdIsAValidatedSegment() {
        val r = rest()
        r.putFolder(ShareRules.folderConfig("/x", id, emptyList()))
        assertEquals("PUT", seen.last().method)
        assertEquals("/rest/config/folders/neo-quiz", seen.last().path)
        assertTrue(seen.last().body.contains("\"neo-quiz\""))
        for (bad in listOf("../x", "a/b", "a?b", "", "..", ".x/../y")) {
            assertThrows("bad id: $bad", IllegalArgumentException::class.java) { r.deleteDevice(bad) }
        }
        assertEquals(1, seen.size)
    }

    @Test fun setIgnoresPostsTheTwoLines() {
        rest().setIgnores(ShareRules.FOLDER_ID, ShareRules.IGNORES)
        assertEquals("POST", seen.last().method)
        assertEquals("/rest/db/ignores?folder=neo-quiz", seen.last().path)
        assertTrue(seen.last().body.contains(".trash"))
    }

    @Test fun shutdownAndAnEmptyBodyAreFine() {
        reply = ""
        status = 200
        val r = rest()
        r.shutdown()
        assertEquals("/rest/system/shutdown", seen.last().path)
        assertEquals(0, r.devices().length())
    }
}
