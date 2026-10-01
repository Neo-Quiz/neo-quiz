package com.ahmedmili.neoquiz.notify

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class DueCalendarTest {
    private class Memory(var raw: String? = null) : DueCalendar.Storage {
        override fun read() = raw
        override fun write(raw: String) { this.raw = raw }
    }

    private val texts = DueCalendar.Texts("Daily review", "{count} question to review today", "{count} questions to review today")

    private fun week(): JSONArray = JSONArray(
        (1..7).joinToString(prefix = "[", postfix = "]") { """{"date":"2026-10-0$it","due":${it * 2}}""" },
    )

    @Test fun `a saved day gives its due count`() {
        val calendar = DueCalendar(Memory())
        calendar.save(week(), texts)
        assertEquals(6, calendar.dueOn("2026-10-03"))
        assertEquals(14, calendar.dueOn("2026-10-07"))
    }

    @Test fun `a day that is not listed gives null, never a guess`() {
        val calendar = DueCalendar(Memory())
        calendar.save(week(), texts)
        assertNull(calendar.dueOn("2026-10-08"))
        assertNull(calendar.dueOn("2026-09-30"))
    }

    @Test fun `nothing saved gives null`() {
        assertNull(DueCalendar(Memory()).dueOn("2026-10-01"))
        assertNull(DueCalendar(Memory()).texts())
    }

    @Test fun `malformed stored JSON gives null`() {
        for (raw in listOf("{not json", "[]", "\"x\"", """{"days":"oops","texts":{}}""")) {
            val calendar = DueCalendar(Memory(raw))
            assertNull(raw, calendar.dueOn("2026-10-01"))
            assertNull(raw, calendar.texts())
        }
    }

    @Test fun `a stored entry with a non integer or negative count gives null`() {
        val raw = """{"days":{"2026-10-01":"many","2026-10-02":-3,"2026-10-03":1.5},"texts":{"title":"t","bodyOne":"1","bodyOther":"n"}}"""
        val calendar = DueCalendar(Memory(raw))
        for (d in listOf("2026-10-01", "2026-10-02", "2026-10-03")) assertNull(d, calendar.dueOn(d))
    }

    @Test fun `a table with a bad entry is refused whole and keeps the previous one`() {
        val memory = Memory()
        val calendar = DueCalendar(memory)
        calendar.save(week(), texts)
        for (bad in listOf("""[{"date":"tomorrow","due":1}]""", """[{"date":"2026-10-01","due":-1}]""", """[{"date":"2026-10-01"}]""", """[1]""")) {
            assertThrows(bad, IllegalArgumentException::class.java) { calendar.save(JSONArray(bad), texts) }
        }
        assertEquals(6, calendar.dueOn("2026-10-03"))
    }

    @Test fun `the texts come back as saved and the body follows the count`() {
        val calendar = DueCalendar(Memory())
        calendar.save(week(), texts)
        assertEquals("Daily review", calendar.texts()?.title)
        assertEquals("1 question to review today", calendar.texts()?.body(1))
        assertEquals("6 questions to review today", calendar.texts()?.body(6))
    }

    @Test fun `saving again replaces the old table`() {
        val calendar = DueCalendar(Memory())
        calendar.save(week(), texts)
        calendar.save(JSONArray("""[{"date":"2026-10-09","due":4}]"""), texts)
        assertNull(calendar.dueOn("2026-10-03"))
        assertEquals(4, calendar.dueOn("2026-10-09"))
    }
}
