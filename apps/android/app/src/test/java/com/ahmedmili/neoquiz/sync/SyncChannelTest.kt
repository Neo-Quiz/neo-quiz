package com.ahmedmili.neoquiz.sync

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The two verbs added by the simpler Sync page: `sync.ignorer` and `sync.partagerId`. */
class SyncChannelTest {
    private val id = "CJXCUH3-SLWCMGX-7FKY3GZ-TAJCUWC-V5GKRYB-3APQ7CN-LPPVSJS-OZLDAQJ"

    private class Backend(var own: Any?) : SyncBackend {
        val ignored = ArrayList<String>()
        override suspend fun state(): Map<String, Any?> = mapOf("appareil" to own)
        override suspend fun pair(id: String, name: String?) = "ok"
        override suspend fun pairScanned(id: String, name: String) = "ok"
        override suspend fun forget(id: String) {}
        override suspend fun rename(id: String, name: String) {}
        override suspend fun ignore(id: String) { ignored.add(id) }
    }

    private fun channel(backend: Backend, shared: MutableList<String>) =
        SyncChannel(backend, { null }, { text -> shared.add(text); true }).handlers()

    @Test fun ignoringReachesTheBackend() = runBlocking {
        val b = Backend(id)
        channel(b, ArrayList())["sync.ignorer"]!!(JSONArray().put(id))
        assertEquals(listOf(id), b.ignored)
    }

    @Test fun aSecondShareWhileOneIsOpenReturnsAtOnce() = runBlocking {
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        var calls = 0
        val h = SyncChannel(Backend(id), { null }, { _ -> calls++; gate.await(); true }).handlers()["sync.partagerId"]!!
        val first = async { h(JSONArray().put("systeme")) }
        while (calls == 0) kotlinx.coroutines.yield()
        assertFalse(h(JSONArray().put("systeme")) == true)
        assertEquals(1, calls)
        gate.complete(Unit)
        assertTrue(first.await() == true)
        // The lock is released afterwards.
        assertTrue(h(JSONArray().put("systeme")) == true)
    }

    @Test fun onlyTheSystemChannelSharesAndOnlyThisDevicesOwnId() = runBlocking {
        val shared = ArrayList<String>()
        val h = channel(Backend(id), shared)["sync.partagerId"]!!
        assertTrue(h(JSONArray().put("systeme")) == true)
        assertEquals(listOf(id), shared)
        // The page names a channel and nothing else: any other string shares nothing.
        for (other in listOf("courriel", "discord", "https://evil.example", "", "SYSTEME")) {
            assertFalse(other, h(JSONArray().put(other)) == true)
        }
        assertEquals(1, shared.size)
        // No running sync (no id), or something that is not an id: nothing is shared.
        for (own in listOf(null, "not-an-id")) {
            assertFalse(channel(Backend(own), shared)["sync.partagerId"]!!(JSONArray().put("systeme")) == true)
        }
        assertEquals(1, shared.size)
    }
}
