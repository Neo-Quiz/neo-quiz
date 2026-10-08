package com.ahmedmili.neoquiz.bridge

import java.io.File
import java.nio.file.Files
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayChannelTest {
    private class Rig(var clock: Long = 1_000_000L, var sent: Boolean = true) {
        val dir: File = Files.createTempDirectory("relay").toFile()
        val shared = mutableListOf<Pair<String, List<File>>>()
        var clip: String? = null
        var onClipboard: String? = null
        var reads = 0
        val channel = RelayChannel(
            dir,
            { text, files -> shared.add(text to files); sent },
            { clip = it },
            { reads++; onClipboard },
            { clock },
        )
    }

    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())
    private fun files(vararg pairs: Pair<String, String>) = JSONArray(pairs.map { JSONObject().put("name", it.first).put("base64", b64(it.second)) })

    @Test fun `text and documents reach the share sheet and the prompt is on the clipboard`() = runBlocking {
        val rig = Rig()
        assertTrue(rig.channel.share("Make a quiz", files("cm1.md" to "# Lists")))
        assertEquals("Make a quiz", rig.clip)
        assertEquals("cm1.md", rig.shared[0].second[0].name)
        assertEquals("# Lists", rig.shared[0].second[0].readText())
    }

    @Test fun `text alone is shared without files`() = runBlocking {
        val rig = Rig()
        assertTrue(rig.channel.share("hello", files()))
        assertEquals(0, rig.shared[0].second.size)
    }

    @Test fun `documents are written under the share cache folder only`() = runBlocking {
        val rig = Rig()
        rig.channel.share("t", files("a.md" to "x"))
        assertTrue(rig.shared[0].second[0].canonicalPath.startsWith(rig.dir.canonicalPath))
    }

    @Test fun `refused names never reach disk`() {
        for (bad in listOf("../x.md", "a/b.md", "a\\b.md", "con.md", "CON.txt", "x.exe", "x.bat", "noext", "x.md ", ".md", "a".repeat(200) + ".md", "x.pdf", "x:y.md")) {
            val rig = Rig()
            assertThrows(bad, IllegalArgumentException::class.java) { runBlocking { rig.channel.share("t", files(bad to "x")) } }
            assertEquals(bad, 0, rig.dir.listFiles()?.size ?: 0)
            assertNull(rig.clip)
        }
    }

    @Test fun `limits on text and files`() {
        val rig = Rig()
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("", files()) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("x".repeat(RelayChannel.MAX_TEXT + 1), files()) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("t", JSONArray((1..11).map { JSONObject().put("name", "d$it.md").put("base64", b64("x")) })) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("t", files("big.md" to "x".repeat(RelayChannel.MAX_FILE_BYTES + 1))) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share(42, files()) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("t", "not an array") } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { rig.channel.share("t", JSONArray("""[{"name":"a.md","base64":"!!notbase64!!"}]""")) } }
        assertNull(rig.clip)
        assertEquals(0, rig.dir.listFiles()?.size ?: 0)
    }

    @Test fun `the total size is bounded`() {
        val rig = Rig()
        val chunk = "x".repeat(RelayChannel.MAX_FILE_BYTES)
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { rig.channel.share("t", files(*(1..5).map { "d$it.md" to chunk }.toTypedArray())) }
        }
        assertEquals(0, rig.dir.listFiles()?.size ?: 0)
    }

    @Test fun `ten documents are accepted and duplicate names are kept apart`() = runBlocking {
        val rig = Rig()
        assertTrue(rig.channel.share("t", files("a.md" to "1", "a.md" to "2")))
        assertEquals(2, rig.shared[0].second.map { it.name }.toSet().size)
    }

    @Test fun `two shares less than two seconds apart are refused, and a failed share releases the guard`() = runBlocking {
        val rig = Rig()
        assertTrue(rig.channel.share("t", files("a.md" to "x")))
        rig.clock += 500
        assertThrows(IllegalStateException::class.java) { runBlocking { rig.channel.share("t", files("a.md" to "x")) } }
        rig.clock += 3_000
        rig.sent = false
        assertFalse(rig.channel.share("t", files("a.md" to "x")))
        assertEquals("a failed share leaves no folder", 1, rig.dir.listFiles()?.count { it.isDirectory } ?: 0)
        rig.sent = true
        assertTrue("the guard was released", rig.channel.share("t", files("a.md" to "x")))
    }

    @Test fun `old share folders are purged`() = runBlocking {
        val rig = Rig()
        rig.channel.share("t", files("a.md" to "x"))
        val old = rig.dir.listFiles()!!.first { it.isDirectory }
        old.setLastModified(rig.clock - RelayChannel.MAX_AGE_MS - 1)
        rig.clock += 5_000
        rig.channel.share("t", files("b.md" to "y"))
        assertFalse(old.exists())
    }

    @Test fun `the clipboard is read only through the explicit call, bounded`() {
        val rig = Rig()
        assertEquals("nothing reads the clipboard before the call", 0, rig.reads)
        rig.onClipboard = "answer"
        assertEquals("answer", rig.channel.readClipboard())
        rig.onClipboard = null
        assertNull(rig.channel.readClipboard())
        rig.onClipboard = "x".repeat(RelayChannel.MAX_CLIPBOARD + 1)
        assertThrows(IllegalArgumentException::class.java) { rig.channel.readClipboard() }
    }

    @Test fun `sharing never reads the clipboard`() = runBlocking {
        val rig = Rig()
        rig.channel.share("t", files("a.md" to "x"))
        assertEquals(0, rig.reads)
    }

    @Test fun `handlers expose exactly the two channels`() {
        assertEquals(setOf("android.partagerPrompt", "android.lirePressePapier"), Rig().channel.handlers().keys)
    }
}
