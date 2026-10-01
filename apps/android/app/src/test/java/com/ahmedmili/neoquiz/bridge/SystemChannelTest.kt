package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SystemChannelTest {
    private lateinit var root: File
    private lateinit var other: File
    private lateinit var allowed: AllowedRoots
    private lateinit var perimeter: Perimeter
    private lateinit var settings: SettingsChannel
    private val opened = ArrayList<File>()
    private var picked: File? = null
    private lateinit var system: SystemChannel

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("system").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        other = File(base, "other").apply { mkdirs() }
        allowed = AllowedRoots().apply { allow(root) }
        val priv = File(base, "private").apply { mkdirs() }
        perimeter = Perimeter(allowed::roots, priv)
        settings = SettingsChannel(File(priv, "settings.json"), perimeter, allowed) { File(base, "default") }
        system = SystemChannel(perimeter, allowed, settings, { picked }, { opened.add(it); true })
    }

    @Test fun opensAnAllowedDocument() = runBlocking {
        File(root, "fiche.pdf").writeText("x")
        assertTrue(system.ouvrir(File(root, "fiche.pdf").path))
        assertEquals(listOf(File(root, "fiche.pdf")), opened)
    }

    @Test fun refusesExecutableExtensionsTheWayWindowsReadsThem() = runBlocking {
        for (name in listOf("x.bat", "X.BAT", ".bat", "notes.pdf.exe", "run.js", "a.apk")) {
            assertFalse(name, system.ouvrir(root.path + "/" + name))
        }
        assertEquals(emptyList<File>(), opened)
        assertTrue(extensionRefusee("x.bat."))
        assertTrue(extensionRefusee("x.bat "))
        assertTrue(extensionRefusee("x.bat::\$DATA"))
        assertTrue(extensionRefusee("C:\\dir\\x.BAT."))
        assertTrue(extensionRefusee("x.sh").not())
        assertTrue(extensionRefusee("x.pdf").not())
        assertTrue(extensionRefusee("noextension").not())
    }

    @Test fun openRefusesOutsideThePerimeter() {
        val e = assertThrows(SecurityException::class.java) { runBlocking { system.ouvrir(File(other, "a.pdf").path) } }
        assertEquals("outside-perimeter", e.message)
    }

    @Test fun pickedFolderEntersThePerimeter() = runBlocking {
        picked = other
        val path = system.choisirDossier()
        assertEquals(other.path.replace('\\', '/'), path)
        assertTrue(perimeter.contains(File(other, "a.md").path))
        picked = null
        assertNull(system.choisirDossier())
    }

    @Test fun pickedDefaultFolderIsCreatedAllowedAndKept() = runBlocking {
        picked = File(other, "Neo Quiz")
        val path = system.choisirDossierDefaut()
        assertTrue(File(path!!).isDirectory)
        assertEquals(path, settings.dossierDefaut())
        assertTrue(perimeter.contains(File(other, "Neo Quiz/q.md").path))
    }

    @Test fun handlersCoverTheFourChannels() {
        assertEquals(
            setOf("dialogue.choisirDossier", "systeme.choisirDossierDefaut", "systeme.ouvrir"),
            system.handlers().keys,
        )
        runBlocking { assertEquals(false, system.handlers().getValue("systeme.ouvrir")(JSONArray().put(File(root, "a.bat").path))) }
    }
}
