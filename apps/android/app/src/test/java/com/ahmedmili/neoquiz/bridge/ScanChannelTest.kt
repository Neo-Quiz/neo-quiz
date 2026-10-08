package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ScanChannelTest {
    private lateinit var root: File
    private lateinit var scan: ScanChannel
    private val events = ArrayList<Map<String, Any?>>()

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("scan").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        val allowed = AllowedRoots().apply { allow(root) }
        scan = ScanChannel(Perimeter(allowed::roots, File(base, "private"))) { events.add(it) }
    }

    private fun p(name: String) = File(root, name).path.replace('\\', '/')
    private fun put(name: String, text: String) = File(root, name).apply { parentFile.mkdirs() }.writeText(text)
    private fun names(entries: List<Map<String, Any?>>) = entries.map { (it["chemin"] as String).removePrefix(p("")).trimStart('/') }.toSet()

    /** The usual order of the renderer: demarrer, liste (hydration), surveiller. */
    private suspend fun watch() {
        scan.demarrer(listOf(root.path))
        scan.liste(root.path)
        scan.surveiller()
    }

    @Test fun renameGivesADeleteThenACreate() = runBlocking {
        put("a.md", "x")
        watch()
        Files.move(File(root, "a.md").toPath(), File(root, "b.md").toPath())
        scan.rescan()
        assertEquals(2, events.size)
        assertEquals(mapOf("kind" to "delete", "abs" to p("a.md")), events[0])
        assertEquals("create", events[1]["kind"])
        assertEquals(p("b.md"), events[1]["abs"])
        assertTrue((events[1]["mtime"] as Long) > 0)
    }

    @Test fun hiddenFoldersAreNeverListedNorWatched() = runBlocking {
        put("q.md", "q")
        put(".neo-quiz/journal/x.jsonl", "j")
        put(".stfolder/marker", "m")
        put("node_modules/n.md", "n")
        scan.demarrer(listOf(root.path))
        assertEquals(setOf("q.md"), names(scan.liste(root.path)))
        scan.surveiller()
        put(".neo-quiz/journal/x.jsonl", "more")
        put(".stfolder/other", "o")
        scan.rescan()
        assertEquals(emptyList<Any>(), events)
    }

    @Test fun listeShapeAndMtimeOnlyForMarkdown() = runBlocking {
        put("q.md", "q")
        put("img.png", "i")
        scan.demarrer(listOf(root.path))
        val out = scan.liste(root.path)
        assertTrue((out.first { (it["chemin"] as String).endsWith("q.md") }["mtime"] as Long) > 0)
        assertEquals(0L, out.first { (it["chemin"] as String).endsWith("img.png") }["mtime"])
        assertEquals(setOf("chemin", "mtime"), out.first().keys)
    }

    @Test fun aChangedFileIsAModifyAndAnUntouchedOneIsSilent() = runBlocking {
        put("a.md", "x")
        put("b.md", "y")
        watch()
        scan.rescan()
        assertEquals(emptyList<Any>(), events)
        put("a.md", "longer content")
        scan.rescan()
        assertEquals(1, events.size)
        assertEquals("modify", events[0]["kind"])
        assertEquals(p("a.md"), events[0]["abs"])
        scan.rescan()
        assertEquals(1, events.size)
    }

    @Test fun nothingIsEmittedBeforeSurveillerOrWithoutABaseline() = runBlocking {
        scan.rescan()
        scan.demarrer(listOf(root.path))
        scan.rescan()
        put("a.md", "x")
        scan.liste(root.path)
        put("b.md", "y")
        scan.rescan()
        assertEquals(emptyList<Any>(), events)
        scan.surveiller()
        scan.rescan()
        assertEquals(1, events.size)
        assertEquals(p("b.md"), events[0]["abs"])
    }

    @Test fun demarrerKeepsOnlyAllowedRootsAndRescanSkipsTheOthers() = runBlocking {
        scan.handlers().getValue("demarrer")(JSONArray().put(JSONArray().put(root.path).put(root.parent)))
        assertEquals(listOf(root), scan.startedRoots())
    }

    @Test fun anAbsentOrForeignRootIsRefused() {
        val e = org.junit.Assert.assertThrows(SecurityException::class.java) { runBlocking { scan.liste(root.parent) } }
        assertEquals("outside-perimeter", e.message)
    }

    /** A write the page's catalogue can see is followed by a rescan; a dot folder (journals, trash) never is. */
    @Test
    fun visibleToCatalogue_skipsDotFolders() {
        assertTrue(ScanChannel.visibleToCatalogue("/storage/emulated/0/Neo Quiz/XTI301/New quiz.md"))
        assertTrue(ScanChannel.visibleToCatalogue("C:\\Neo Quiz\\Cours\\q.md"))
        assertEquals(false, ScanChannel.visibleToCatalogue("/storage/emulated/0/Neo Quiz/.neo-quiz/journal/phone.jsonl"))
        assertEquals(false, ScanChannel.visibleToCatalogue("/storage/emulated/0/Neo Quiz/.trash/XTI301/New quiz.md"))
        assertEquals(false, ScanChannel.visibleToCatalogue("/storage/emulated/0/Neo Quiz/Cours/.import-0123456789ab/q.md"))
    }
}
