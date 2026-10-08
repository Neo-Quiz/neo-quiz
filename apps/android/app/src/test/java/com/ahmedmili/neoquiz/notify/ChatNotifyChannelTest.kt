package com.ahmedmili.neoquiz.notify

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class ChatNotifyChannelTest {
    private class Memory : ChatNotifyChannel.Store {
        val map = HashMap<String, String?>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) { map[key] = value }
    }

    private val device = "22222222-2222-4222-8222-222222222222"
    private fun texts(): String = """{"quizReady":"Quiz ready: {title}","quizReadyMore":"Quiz ready: {title} (+{extra})","textReady":"Answer ready","failed":"Generation failed: {error}","channel":"Chats"}"""
    private fun call(channel: ChatNotifyChannel, name: String, args: String = "[]") =
        runBlocking { channel.handlers().getValue(name)(JSONArray(args)) }

    @Test fun `registration keeps the device id and texts`() {
        val store = Memory()
        call(ChatNotifyChannel(store), "android.suivreChats", """["$device", ${texts()}]""")
        assertEquals(device, store.get(ChatNotifyChannel.KEY_DEVICE))
        assertEquals("Chats", ChatNotifyChannel.Texts.parse(store.get(ChatNotifyChannel.KEY_TEXTS))?.channel)
    }

    @Test fun `a device id that is not a uuid is refused`() {
        val store = Memory()
        assertThrows(IllegalArgumentException::class.java) { call(ChatNotifyChannel(store), "android.suivreChats", """["../x", ${texts()}]""") }
        assertNull(store.get(ChatNotifyChannel.KEY_DEVICE))
    }

    @Test fun `texts that are not strings or are too long are refused`() {
        val store = Memory()
        for (bad in listOf("""{"quizReady":3}""", """{"quizReady":"${"x".repeat(300)}","quizReadyMore":"a","textReady":"b","failed":"c","channel":"d"}""", "{}")) {
            assertThrows(IllegalArgumentException::class.java) { call(ChatNotifyChannel(store), "android.suivreChats", """["$device", $bad]""") }
        }
        assertNull(store.get(ChatNotifyChannel.KEY_TEXTS))
    }

    @Test fun `a tap path is handed to the page once, and only if clean`() {
        val channel = ChatNotifyChannel(Memory())
        channel.openQuiz("Python/Lists - Learn.md")
        assertEquals("Python/Lists - Learn.md", call(channel, "android.quizDemande"))
        assertNull(call(channel, "android.quizDemande"))
        channel.openQuiz("../etc/passwd")
        assertNull(call(channel, "android.quizDemande"))
    }

    @Test fun `texts are rendered with placeholders replaced`() {
        val t = ChatNotifyChannel.Texts("Quiz ready: {title}", "Quiz ready: {title} (+{extra})", "Answer ready", "Generation failed: {error}", "Chats")
        assertEquals("Quiz ready: Lists", t.render(ChatNotifyRules.Pending("r", ChatNotifyRules.Kind.QUIZ, "Lists", "a.md", 0)))
        assertEquals("Quiz ready: Lists (+2)", t.render(ChatNotifyRules.Pending("r", ChatNotifyRules.Kind.QUIZ, "Lists", "a.md", 2)))
        assertEquals("Answer ready", t.render(ChatNotifyRules.Pending("r", ChatNotifyRules.Kind.TEXT, "", null, 0)))
        assertEquals("Generation failed: boom", t.render(ChatNotifyRules.Pending("r", ChatNotifyRules.Kind.FAILED, "boom", null, 0)))
    }

    @Test fun `text is cut by code points, never inside a surrogate pair`() {
        val s = "a" + "\uD83D\uDE00".repeat(5)
        assertEquals("a\uD83D\uDE00", ChatNotifyChannel.cut(s, 2))
        assertEquals("abc", ChatNotifyChannel.cut("abc", 80))
    }

    @Test fun `the default texts are English`() {
        assertEquals("Answer ready", ChatNotifyChannel.Texts.DEFAULT.textReady)
    }
}
