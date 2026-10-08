package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The family of bug that left a deleted quiz in the list on Android (2026-10-08):
 * the phone has no file watcher, so the page only learns of ITS OWN writes if the
 * bridge reports them. This mounts the real `FilesChannel` and `ScanChannel`
 * with the real [OwnWriteRescan] hook, as `createAppBridge` does, and drives the
 * page's channels by name (`fichiers.trash`, `write`, `rename`, `remove`): each
 * must come out as the file event the page expects, with no watcher anywhere.
 */
class OwnWriteRescanTest {
    private lateinit var root: File
    private lateinit var scan: ScanChannel
    private lateinit var handlers: Map<String, suspend (JSONArray) -> Any?>
    private lateinit var scope: CoroutineScope
    private val events = Collections.synchronizedList(ArrayList<Map<String, Any?>>())

    @Before
    fun setUp() {
        val base = Files.createTempDirectory("ownwrite").toFile().canonicalFile
        root = File(base, "root").apply { mkdirs() }
        val allowed = AllowedRoots().apply { allow(root) }
        val perimeter = Perimeter(allowed::roots, File(base, "private"))
        scan = ScanChannel(perimeter) { events.add(it) }
        scope = CoroutineScope(Dispatchers.Default + Job())
        val hook = OwnWriteRescan(scope, scan::rescan, delayMs = 30)
        handlers = FilesChannel(perimeter, allowed) { hook.onWrite(it) }.handlers()
    }

    @After
    fun tearDown() {
        scope.cancel()
    }

    private fun p(name: String) = File(root, name).path.replace("\\", "/")
    private fun put(name: String, text: String) = File(root, name).apply { parentFile!!.mkdirs() }.writeText(text)
    private fun args(vararg a: String) = JSONArray(a.toList())

    /** The renderer's start-up order: demarrer, liste (hydration), surveiller. */
    private suspend fun page() {
        scan.demarrer(listOf(root.path))
        scan.liste(root.path)
        scan.surveiller()
    }

    private suspend fun call(channel: String, vararg a: String) = handlers.getValue(channel)(args(*a))

    /** What the page does before writing into a folder that may not exist (`ensureFolder`). */
    private suspend fun write(name: String, text: String) {
        call("fichiers.mkdirs", p(name.substringBeforeLast('/', "")))
        call("fichiers.write", p(name), text)
    }

    private fun kinds() = synchronized(events) { events.map { "${it["kind"]} ${(it["abs"] as String).removePrefix(p("")).trimStart('/')}" } }

    /** Waits (up to 5 s) until [want] holds of the events seen so far. */
    private fun awaitEvents(want: (List<String>) -> Boolean): List<String> = runBlocking {
        repeat(100) { if (want(kinds())) return@runBlocking kinds(); delay(50) }
        kinds()
    }

    @Test fun trashOfAVisibleQuizComesOutAsADelete() = runBlocking {
        put("Alpha/Quiz.md", "q")
        page()
        call("fichiers.trash", p("Alpha/Quiz.md"), root.path.replace("\\", "/"))
        assertEquals(listOf("delete Alpha/Quiz.md"), awaitEvents { it.isNotEmpty() })
        assertTrue(File(root, ".trash/Alpha/Quiz.md").exists())
    }

    @Test fun aNewFileComesOutAsACreateAndARewriteAsAModify() = runBlocking {
        page()
        write("Alpha/New.md", "one")
        assertEquals(listOf("create Alpha/New.md"), awaitEvents { it.isNotEmpty() })
        write("Alpha/New.md", "a longer second text")
        assertEquals(listOf("create Alpha/New.md", "modify Alpha/New.md"), awaitEvents { it.size >= 2 })
    }

    @Test fun renameComesOutAsADeleteAndACreate() = runBlocking {
        put("Alpha/A.md", "q")
        File(root, "Beta").mkdirs()
        page()
        call("fichiers.rename", p("Alpha/A.md"), p("Beta/A.md"))
        assertEquals(setOf("delete Alpha/A.md", "create Beta/A.md"), awaitEvents { it.size >= 2 }.toSet())
    }

    @Test fun movingAWholeFolderReportsEveryFileOnBothSides() = runBlocking {
        put("Alpha/A.md", "a")
        put("Alpha/Sub/B.md", "b")
        page()
        call("fichiers.rename", p("Alpha"), p("Gamma"))
        val seen = awaitEvents { it.size >= 4 }
        assertEquals(setOf("delete Alpha/A.md", "delete Alpha/Sub/B.md", "create Gamma/A.md", "create Gamma/Sub/B.md"), seen.toSet())
    }

    @Test fun removeComesOutAsADelete() = runBlocking {
        put("Alpha/Gone.md", "q")
        page()
        call("fichiers.remove", p("Alpha/Gone.md"))
        assertEquals(listOf("delete Alpha/Gone.md"), awaitEvents { it.isNotEmpty() })
    }

    @Test fun aWriteUnderADotFolderTriggersNothing() = runBlocking {
        page()
        write(".neo-quiz/journal/phone.jsonl", "j")
        write("Alpha/.import-0123456789ab/q.md", "staged")
        delay(400)
        assertEquals(emptyList<String>(), kinds())
    }

    @Test fun anImportOfManyFilesCostsOneWalkAndNoDuplicateEvent() = runBlocking {
        page()
        repeat(8) { write("Imported/Q$it.md", "q$it") }
        val seen = awaitEvents { it.size >= 8 }
        delay(300)
        assertEquals(8, kinds().size)
        assertEquals(seen.toSet(), kinds().toSet())
    }
}
