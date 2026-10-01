package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeTest {
    private fun allHandlers(): Map<String, suspend (org.json.JSONArray) -> Any?> {
        val base = Files.createTempDirectory("bridge").toFile()
        val allowed = AllowedRoots()
        val perimeter = Perimeter(allowed::roots, File(base, "private"))
        val settings = SettingsChannel(File(base, "private/settings.json"), perimeter, allowed) { File(base, "d") }
        return FilesChannel(perimeter, allowed).handlers() +
            ScanChannel(perimeter) { }.handlers() +
            SystemChannel(perimeter, allowed, settings, { null }, { true }).handlers() +
            settings.handlers() +
            CodeChannel(object : com.ahmedmili.neoquiz.code.CodeEngine {
                override suspend fun run(job: Any?) = JSONObject()
                override fun warm(language: String) {}
                override fun packState(name: String) = emptyMap<String, Any?>()
            }).handlers() +
            Unavailable.handlers()
    }

    @Test fun handlersAndChannelsAreTheSameSet() {
        assertEquals(Channels.ALL, allHandlers().keys)
    }

    @Test fun theCodeChannelsAreHandledAndThePackIsNeverDownloaded() {
        assertTrue(Unavailable.names.none { it in setOf("code.run", "code.warm", "langages.etat") })
        assertTrue(Unavailable.names.containsAll(setOf("langages.installer", "langages.supprimer")))
    }

    @Test fun noChannelIsBothHandledAndUnavailable() {
        val handled = allHandlers().keys - Unavailable.names
        assertEquals(Channels.ALL.size - Unavailable.names.size, handled.size)
    }

    private fun call(bridge: Bridge, json: String): JSONObject {
        val latch = CountDownLatch(1)
        var out = ""
        bridge.dispatch(json) { out = it; latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        return JSONObject(out)
    }

    @Test fun repliesWithValueErrorAndUnknownChannel() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val bridge = Bridge(scope, mapOf(
            "ok" to { _ -> mapOf("mtime" to 5, "x" to null) },
            "boom" to { _ -> throw IllegalStateException("x existe déjà") },
        ))
        val ok = call(bridge, """{"id":1,"canal":"ok","args":[]}""")
        assertEquals(1, ok.getInt("id"))
        assertTrue(ok.getBoolean("ok"))
        assertEquals(5, ok.getJSONObject("valeur").getInt("mtime"))
        val boom = call(bridge, """{"id":2,"canal":"boom","args":[]}""")
        assertEquals(false, boom.getBoolean("ok"))
        assertEquals("x existe déjà", boom.getString("erreur"))
        val unknown = call(bridge, """{"id":3,"canal":"nope","args":[]}""")
        assertEquals("unknown-channel: nope", unknown.getString("erreur"))
    }

    @Test fun emitPushesAnEventToTheSink() {
        val bridge = Bridge(CoroutineScope(Dispatchers.Default), emptyMap())
        var got = ""
        bridge.sink = { got = it }
        bridge.emit("evenement", mapOf("kind" to "create"))
        val o = JSONObject(got)
        assertEquals("evenement", o.getString("evenement"))
        assertEquals("create", o.getJSONObject("donnees").getString("kind"))
    }
}
