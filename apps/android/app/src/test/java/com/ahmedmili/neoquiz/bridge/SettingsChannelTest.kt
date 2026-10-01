package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SettingsChannelTest {
    private lateinit var root: File
    private lateinit var priv: File
    private lateinit var settingsFile: File
    private lateinit var allowed: AllowedRoots
    private lateinit var settings: SettingsChannel

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("settings").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        priv = File(base, "private").apply { mkdirs() }
        settingsFile = File(priv, "settings.json")
        allowed = AllowedRoots().apply { allow(root) }
        settings = SettingsChannel(settingsFile, Perimeter(allowed::roots, priv), allowed) { File(base, "default") }
    }

    private fun refused(block: suspend () -> Unit) {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { block() } }
    }

    @Test fun roundTripAndMissingKey() = runBlocking {
        assertNull(settings.lire("a"))
        settings.ecrire("a", "x")
        settings.ecrire("n", 3)
        assertEquals("x", settings.lire("a"))
        assertEquals(3, settings.lire("n"))
        settings.supprimer("a")
        assertNull(settings.lire("a"))
        assertEquals(3, settings.lire("n"))
        assertEquals(listOf("settings.json"), priv.list()!!.toList())
    }

    @Test fun concurrentWritesKeepEveryKey() = runBlocking {
        (1..30).map { i -> async(Dispatchers.Default) { settings.ecrire("k$i", i) } }.awaitAll()
        assertEquals(30, JSONObject(settingsFile.readText()).length())
    }

    @Test fun unreadableFileIsSetAsideNotTakenForEmpty() = runBlocking {
        settingsFile.writeText("{ not json")
        assertNull(settings.lire("a"))
        assertTrue(priv.list()!!.any { it.startsWith("settings.json.corrompu-") })
    }

    @Test fun foldersOutsideThePerimeterAreRefused() {
        val outside = File(root.parentFile, "elsewhere").apply { mkdirs() }
        refused { settings.ecrire("folders", JSONArray().put(JSONObject().put("path", outside.path))) }
        refused { settings.ecrire("folder", outside.path) }
        refused { settings.ecrire("defaultFolder", outside.path) }
        refused { settings.ecrire("fond", JSONObject().put("dossier", outside.path).put("image", "a.png")) }
        refused { settings.ecrire("fond", JSONObject().put("dossier", root.path).put("image", "../a.png")) }
        runBlocking {
            settings.ecrire("folders", JSONArray().put(JSONObject().put("path", root.path)))
            settings.ecrire("fond", JSONObject().put("embarque", "aurora"))
            settings.ecrire("defaultFolder", null)
        }
    }

    @Test fun syncKeysAreReserved() {
        refused { settings.ecrire("syncActif", true) }
        refused { settings.ecrire("syncRoot", root.path) }
        refused { settings.supprimer("syncRoot") }
    }

    @Test fun seedRootsAdmitsTheFoldersKeptByAPreviousSession() = runBlocking {
        val kept = File(root.parentFile, "kept").apply { mkdirs() }
        settingsFile.writeText(JSONObject().put("folders", JSONArray().put(JSONObject().put("path", kept.path))).toString())
        settings.seedRoots()
        assertTrue(allowed.roots().contains(kept.canonicalFile))
    }

    @Test fun dossierDefautCreatesAndAdmitsTheAppFolder() = runBlocking {
        val path = settings.dossierDefaut()
        assertTrue(File(path).isDirectory)
        assertTrue(allowed.roots().any { it == File(path).canonicalFile })
    }
}
