package com.ahmedmili.neoquiz.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatNotifyRulesTest {
    private val me = "22222222-2222-4222-8222-222222222222"
    private val pc = "11111111-1111-4111-8111-111111111111"

    private fun request(id: String, from: String = me, state: String = "done", results: String = """[{"kind":"quiz","title":"Lists","path":"Python/Lists - Learn.md"}]""", error: String = "") =
        """{"id":"$id","at":1,"from":"$from","text":"t","mode":"learn","documents":[],"results":$results,"state":"$state"${if (error.isEmpty()) "" else ""","error":"$error""""}}"""

    private fun file(vararg requests: String, version: Int = 1) =
        """{"v":$version,"chats":[{"id":"chat-1234","origin":"$pc","createdAt":1,"updatedAt":2,"requests":[${requests.joinToString(",")}]}]}"""

    @Test fun `a finished request of ours with a quiz notifies with its title and clean path`() {
        val out = ChatNotifyRules.parse(file(request("r1")), me)
        assertEquals(listOf(ChatNotifyRules.Pending("r1", ChatNotifyRules.Kind.QUIZ, "Lists", "Python/Lists - Learn.md", 0)), out)
    }

    @Test fun `several quizzes in one request make one notification that counts the others`() {
        val results = """[{"kind":"quiz","title":"A","path":"a.md"},{"kind":"quiz","title":"B","path":"b.md"},{"kind":"quiz","title":"C","path":"c.md"}]"""
        val out = ChatNotifyRules.parse(file(request("r1", results = results)), me)
        assertEquals(1, out.size)
        assertEquals("A", out[0].title)
        assertEquals(2, out[0].extra)
    }

    @Test fun `a request sent by another device is never ours`() {
        assertTrue(ChatNotifyRules.parse(file(request("r1", from = pc)), me).isEmpty())
    }

    @Test fun `a failed request notifies with the first line of its error, bounded`() {
        val out = ChatNotifyRules.parse(file(request("r1", state = "failed", results = "[]", error = "x".repeat(500))), me)
        assertEquals(ChatNotifyRules.Kind.FAILED, out[0].kind)
        assertEquals(ChatNotifyRules.MAX_ERROR, out[0].title.length)
    }

    @Test fun `a stopped request is not announced`() {
        assertTrue(ChatNotifyRules.parse(file(request("r1", state = "stopped", results = "[]")), me).isEmpty())
    }

    @Test fun `a text-only answer notifies as text`() {
        val out = ChatNotifyRules.parse(file(request("r1", results = """[{"kind":"text","text":"hello"}]""")), me)
        assertEquals(ChatNotifyRules.Kind.TEXT, out[0].kind)
    }

    @Test fun `a quiz card without a usable path still notifies but never carries a path`() {
        for (bad in listOf("", "../x.md", "/abs.md", "C:/x.md", "a\\\\b.md", ".neo-quiz/chats/x.json")) {
            val results = """[{"kind":"quiz","title":"T","path":"$bad"}]"""
            val out = ChatNotifyRules.parse(file(request("r1", results = results)), me)
            assertEquals("path $bad", 1, out.size)
            assertEquals("path $bad", null, out[0].path)
        }
    }

    @Test fun `title is cut and stripped of control characters`() {
        val results = """[{"kind":"quiz","title":"a\u0000b\nc${"z".repeat(300)}","path":"a.md"}]"""
        val title = ChatNotifyRules.parse(file(request("r1", results = results)), me)[0].title
        assertTrue(title.length <= ChatNotifyRules.MAX_TITLE)
        assertFalse(title.any { it < ' ' })
    }

    @Test fun `malformed or foreign versions give nothing and never throw`() {
        for (bad in listOf("", "{ torn", "null", "[]", """{"v":2,"chats":[]}""", """{"v":1}""", """{"v":1,"chats":{}}""", """{"v":1,"chats":[{"id":3}]}""", file(request("r1"), version = 9))) {
            assertTrue(bad, ChatNotifyRules.parse(bad, me).isEmpty())
        }
    }

    @Test fun `a request with a missing field is skipped but its neighbour is kept`() {
        val out = ChatNotifyRules.parse(file("""{"id":"x","from":"$me"}""", request("r2")), me)
        assertEquals(listOf("r2"), out.map { it.key })
    }

    @Test fun `select raises each key once and keeps the list bounded`() {
        val p = ChatNotifyRules.Pending("r1", ChatNotifyRules.Kind.QUIZ, "T", null, 0)
        val (first, notified) = ChatNotifyRules.select(listOf(p), emptyList())
        assertEquals(listOf(p), first)
        val (second, again) = ChatNotifyRules.select(listOf(p), notified)
        assertTrue(second.isEmpty())
        assertEquals(notified, again)
        val many = (1..300).map { ChatNotifyRules.Pending("k$it", ChatNotifyRules.Kind.TEXT, "t", null, 0) }
        val (_, bounded) = ChatNotifyRules.select(many, emptyList())
        assertEquals(ChatNotifyRules.MAX_NOTIFIED, bounded.size)
        assertEquals("k300", bounded.last())
    }

    @Test fun `a duplicate request id in one file is raised once`() {
        val out = ChatNotifyRules.select(ChatNotifyRules.parse(file(request("r1"), request("r1")), me), emptyList()).first
        assertEquals(1, out.size)
    }

    @Test fun `only other devices' plain json files are read`() {
        assertTrue(ChatNotifyRules.readable("$pc.json", me))
        assertFalse(ChatNotifyRules.readable("$me.json", me))
        assertFalse(ChatNotifyRules.readable("$pc.sync-conflict-20261008-101500-ABCDEFG.json", me))
        assertFalse(ChatNotifyRules.readable("$pc.json.tmp", me))
        assertFalse(ChatNotifyRules.readable("notes.txt", me))
    }

    @Test fun `clean relative paths`() {
        assertTrue(ChatNotifyRules.isCleanRelativePath("a/b c.md"))
        for (bad in listOf("", "..", "a/../b", "/a", "a//b", "a/./b", "C:x", "a\\b", ".neo-quiz/x")) assertFalse(bad, ChatNotifyRules.isCleanRelativePath(bad))
    }

    @Test fun `owner id is compared case-insensitively`() {
        assertEquals(1, ChatNotifyRules.parse(file(request("r1", from = me.uppercase())), me).size)
    }

    @Test fun `bidi and zero-width characters are stripped`() {
        val results = """[{"kind":"quiz","title":"a‮b​c⁦d","path":"a.md"}]"""
        assertEquals("abcd", ChatNotifyRules.parse(file(request("r1", results = results)), me)[0].title)
    }

    @Test fun `an oversized text is ignored`() {
        val big = file(request("r1")) + " ".repeat(ChatNotifyRules.MAX_FILE_BYTES.toInt())
        assertTrue(ChatNotifyRules.parse(big, me).isEmpty())
    }

    @Test fun `only a bounded number of requests is examined`() {
        val many = (1..1000).map { request("r$it") }.toTypedArray()
        assertTrue(ChatNotifyRules.parse(file(*many), me).size <= ChatNotifyRules.MAX_REQUESTS)
    }

    @Test fun `a chat with a wrongly typed field is skipped`() {
        val bad = """{"v":1,"chats":[{"id":"c","origin":"$pc","createdAt":"x","updatedAt":2,"requests":[${request("r1")}]}]}"""
        assertTrue(ChatNotifyRules.parse(bad, me).isEmpty())
    }
}
