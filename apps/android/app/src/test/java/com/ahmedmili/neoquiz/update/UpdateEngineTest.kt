package com.ahmedmili.neoquiz.update

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UpdateEngineTest {
    private lateinit var dir: File
    private val apk = ByteArray(5000) { (it % 251).toByte() }
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private class Store(var last: Long = 0L) : CheckStore {
        override fun lastCheck() = last
        override fun setLastCheck(ms: Long) { last = ms }
    }

    private fun manifestJson(size: Long = apk.size.toLong(), digest: String = sha(apk), code: Int = 2) = JSONObject()
        .put("versionCode", code).put("versionName", "0.2.0")
        .put("url", "https://github.com/Neo-Quiz/neo-quiz/releases/download/android-v0.2.0/NeoQuiz-0.2.0.apk")
        .put("sha256", digest).put("size", size).put("notes", "n").toString()

    private class Fixture(val engine: UpdateEngine, val store: Store, val installed: MutableList<File>, val states: MutableList<UpdateState>, val asked: IntArray)

    private fun fixture(
        manifest: String = manifestJson(),
        body: ByteArray = apk,
        canInstall: Boolean = true,
        installedCode: Int = 1,
        failInstall: Boolean = false,
    ): Fixture {
        val store = Store()
        val installed = mutableListOf<File>()
        val states = mutableListOf<UpdateState>()
        val asked = intArrayOf(0)
        val engine = UpdateEngine(
            installedCode = installedCode, installedName = "0.1.0", dir = dir,
            openManifest = { ByteArrayInputStream(manifest.toByteArray()) },
            openApk = { ByteArrayInputStream(body) },
            store = store,
            canInstall = { canInstall },
            askPermission = { asked[0]++ },
            installer = { f -> if (failInstall) throw IOException("no") else installed += f },
            clock = { 10_000L },
            onState = { states += it },
        )
        return Fixture(engine, store, installed, states, asked)
    }

    @Before fun setUp() {
        dir = File(Files.createTempDirectory("upd").toFile(), "update")
    }

    @Test fun aNewerVersionIsOfferedAndNothingIsDownloadedYet() = runBlocking {
        val f = fixture()
        assertTrue(f.engine.check(force = true))
        assertEquals("disponible", f.engine.state.phase)
        assertEquals("0.2.0", f.engine.state.version)
        assertTrue(f.installed.isEmpty())
        assertFalse(dir.exists() && (dir.listFiles()?.isNotEmpty() ?: false))
    }

    @Test fun sameOrOlderVersionIsUpToDate() = runBlocking {
        val f = fixture(installedCode = 2)
        f.engine.check(force = true)
        assertEquals("a-jour", f.engine.state.phase)
    }

    @Test fun anAutomaticCheckWaitsSixHours() = runBlocking {
        val f = fixture()
        f.store.last = 9_000L
        assertFalse(f.engine.check(force = false))
        assertEquals("inactif", f.engine.state.phase)
        assertTrue(f.engine.check(force = true))
    }

    @Test fun anInvalidManifestIsSilentWhenAutomaticAndReportedWhenManual() = runBlocking {
        val f = fixture(manifest = "{}")
        f.engine.check(force = false)
        assertEquals("inactif", f.engine.state.phase)
        f.engine.check(force = true)
        assertEquals("erreur", f.engine.state.phase)
        assertEquals("invalid", f.engine.state.message)
    }

    @Test fun installDownloadsVerifiesAndHandsTheFileToTheInstaller() = runBlocking {
        val f = fixture()
        f.engine.check(true)
        f.engine.install()
        assertEquals("prete", f.engine.state.phase)
        assertEquals(1, f.installed.size)
        assertTrue(f.installed[0].readBytes().contentEquals(apk))
        assertTrue(f.states.any { it.phase == "telechargement" })
    }

    @Test fun aWrongHashNeverReachesTheInstallerAndLeavesNoFile() = runBlocking {
        val f = fixture(manifest = manifestJson(digest = sha(ByteArray(5) { 1 })))
        f.engine.check(true)
        f.engine.install()
        assertEquals("erreur", f.engine.state.phase)
        assertEquals("mismatch", f.engine.state.message)
        assertTrue(f.installed.isEmpty())
        assertTrue(dir.listFiles()?.isEmpty() ?: true)
    }

    @Test fun aWrongSizeNeverReachesTheInstallerAndLeavesNoFile() = runBlocking {
        for (size in listOf(apk.size - 1L, apk.size + 1L)) {
            val f = fixture(manifest = manifestJson(size = size))
            f.engine.check(true)
            f.engine.install()
            assertEquals("mismatch", f.engine.state.message)
            assertTrue(f.installed.isEmpty())
            assertTrue(dir.listFiles()?.isEmpty() ?: true)
        }
    }

    @Test fun withoutTheInstallPermissionTheUserIsSentToTheSettingsAndNothingIsDownloaded() = runBlocking {
        val f = fixture(canInstall = false)
        f.engine.check(true)
        f.engine.install()
        assertEquals("autorisation", f.engine.state.phase)
        assertEquals(1, f.asked[0])
        assertTrue(f.installed.isEmpty())
        assertFalse(f.states.any { it.phase == "telechargement" })
    }

    @Test fun anInstallerFailureDeletesTheDownloadedFile() = runBlocking {
        val f = fixture(failInstall = true)
        f.engine.check(true)
        f.engine.install()
        assertEquals("install", f.engine.state.message)
        assertTrue(dir.listFiles()?.isEmpty() ?: true)
    }

    @Test fun installWithoutAnOfferDoesNothing() = runBlocking {
        val f = fixture()
        f.engine.install()
        assertEquals("inactif", f.engine.state.phase)
        assertTrue(f.installed.isEmpty())
    }
}
