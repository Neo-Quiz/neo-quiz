package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FilesChannelTest {
    private lateinit var root: File
    private lateinit var priv: File
    private lateinit var files: FilesChannel

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("files").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        priv = File(base, "private").apply { mkdirs() }
        val allowed = AllowedRoots().apply { allow(root) }
        files = FilesChannel(Perimeter(allowed::roots, priv), allowed)
    }

    private fun p(name: String) = File(root, name).path

    @Test fun writeIsAtomicAndReturnsMtime() = runBlocking {
        val r = files.write(p("a.md"), "hello é")
        assertEquals("hello é", File(p("a.md")).readText())
        assertEquals(File(p("a.md")).lastModified(), r["mtime"])
        files.write(p("a.md"), "second")
        assertEquals("second", files.read(p("a.md")))
        assertEquals(listOf("a.md"), root.list()!!.toList())
    }

    @Test fun writeBinaryDecodesBase64() = runBlocking {
        val bytes = byteArrayOf(0, 1, 2, -1, 127)
        files.writeBinary(p("b.bin"), Base64.getEncoder().encodeToString(bytes))
        assertTrue(bytes.contentEquals(File(p("b.bin")).readBytes()))
        assertEquals(Base64.getEncoder().encodeToString(bytes), files.readBinary(p("b.bin")))
    }

    @Test fun concurrentAppendsLoseNothing() = runBlocking {
        files.write(p("log.jsonl"), "")
        (1..50).map { i -> async(Dispatchers.Default) { files.append(p("log.jsonl"), "line $i\n") } }.awaitAll()
        val lines = File(p("log.jsonl")).readLines()
        assertEquals(50, lines.size)
        assertEquals((1..50).map { "line $it" }.toSet(), lines.toSet())
    }

    @Test fun staleReadRefusesTheWrite() = runBlocking {
        files.write(p("n.md"), "v1")
        val read = files.lirePourEcriture(p("n.md"))
        assertEquals("v1", read["contenu"])
        files.write(p("n.md"), "v2 from elsewhere")
        assertNull(files.ecrireSiInchange(p("n.md"), read["contenu"] as String, "mine"))
        assertEquals("v2 from elsewhere", File(p("n.md")).readText())
        assertNotNull(files.ecrireSiInchange(p("n.md"), "v2 from elsewhere", "mine"))
        assertEquals("mine", File(p("n.md")).readText())
    }

    @Test fun trashMovesAndNeverDeletes() = runBlocking {
        files.mkdirs(p("sub"))
        files.write(p("sub/x.md"), "keep")
        files.trash(p("sub/x.md"), root.path)
        assertFalse(File(p("sub/x.md")).exists())
        assertEquals("keep", File(p(".trash/sub/x.md")).readText())
        files.write(p("sub/x.md"), "again")
        files.trash(p("sub/x.md"), root.path)
        assertEquals("again", File(p(".trash/sub/x-2.md")).readText())
        assertEquals("keep", File(p(".trash/sub/x.md")).readText())
    }

    @Test fun trashRefusesANonRootSecondArgument() {
        runBlocking { files.write(p("sub.md"), "x") }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { files.trash(p("sub.md"), root.parent) } }
        assertTrue(File(p("sub.md")).exists())
    }

    @Test fun renameRefusesToOverwriteWithTheElectronMessage() = runBlocking {
        files.write(p("a.md"), "a")
        files.write(p("b.md"), "b")
        val e = assertThrows(IllegalStateException::class.java) { runBlocking { files.rename(p("a.md"), p("b.md")) } }
        assertEquals("${File(p("b.md")).canonicalPath.replace('\\', '/')} existe déjà", e.message)
        assertEquals("b", File(p("b.md")).readText())
        files.rename(p("a.md"), p("c.md"))
        assertEquals("a", File(p("c.md")).readText())
        assertFalse(File(p("a.md")).exists())
    }

    @Test fun removeIsQuietWhenAbsent() = runBlocking {
        files.write(p("a.md"), "a")
        files.remove(p("a.md"))
        files.remove(p("a.md"))
        assertFalse(files.exists(p("a.md")))
    }

    @Test fun statListAndFolders() = runBlocking {
        files.mkdirs(p("d/e"))
        files.write(p("d/one.md"), "1")
        assertNull(files.stat(p("d")))
        assertNotNull(files.stat(p("d/one.md")))
        assertNull(files.stat(p("nope")))
        assertEquals(false, files.statEntree(p("d"))!!["isFile"])
        assertNull(files.statEntree(p("nope")))
        assertEquals(listOf(File(p("d/one.md")).path.replace('\\', '/')), files.list(p("d")))
        assertEquals(emptyList<String>(), files.list(p("missing")))
        val entries = files.listerDossier(p("d")).associate { it["name"] to it["isFolder"] }
        assertEquals(mapOf<Any?, Any?>("e" to true, "one.md" to false), entries)
    }

    @Test fun everyChannelRefusesAPathOutsideThePerimeter() {
        val outside = File(root.parentFile, "outside.md").path
        val h = files.handlers()
        for (name in h.keys) {
            val e = assertThrows(name, SecurityException::class.java) {
                runBlocking { h.getValue(name)(JSONArray().put(outside).put("x").put("y")) }
            }
            assertEquals(name, "outside-perimeter", e.message)
        }
    }
}
