package com.ahmedmili.neoquiz.notify

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class CalendarChannelTest {
    private class Memory : DueCalendar.Storage {
        var raw: String? = null
        override fun read() = raw
        override fun write(raw: String) { this.raw = raw }
    }

    private val texts = JSONObject("""{"title":"Daily review","bodyOne":"{count} question","bodyOther":"{count} questions"}""")
    private fun call(channel: CalendarChannel, name: String, vararg args: Any) = runBlocking {
        channel.handlers().getValue(name)(JSONArray().apply { args.forEach { put(it) } })
    }

    @Test fun savingStoresTheTableAndReArmsTheAlarm() {
        val memory = Memory()
        var armed = 0
        val channel = CalendarChannel(DueCalendar(memory)) { armed++ }
        call(channel, "android.calendrier", JSONArray("""[{"date":"2026-10-01","due":3}]"""), texts)
        assertEquals(3, DueCalendar(memory).dueOn("2026-10-01"))
        assertEquals(1, armed)
    }

    @Test fun aMalformedCallIsRefusedAndStoresNothing() {
        val memory = Memory()
        var armed = 0
        val channel = CalendarChannel(DueCalendar(memory)) { armed++ }
        assertThrows(IllegalArgumentException::class.java) { call(channel, "android.calendrier", JSONArray("""[{"date":"x","due":3}]"""), texts) }
        assertThrows(IllegalArgumentException::class.java) { call(channel, "android.calendrier", JSONArray("[]"), JSONObject("""{"title":"t"}""")) }
        assertNull(memory.raw)
        assertEquals(0, armed)
    }

    @Test fun theOpenRequestIsTakenOnce() {
        val channel = CalendarChannel(DueCalendar(Memory())) { }
        assertFalse(call(channel, "android.revisionDemandee") as Boolean)
        ReviewOpenRequest.raise()
        assertTrue(call(channel, "android.revisionDemandee") as Boolean)
        assertFalse(call(channel, "android.revisionDemandee") as Boolean)
    }

    @Test fun theNextTriggerIsTodaySevenIfStillAheadElseTomorrow() {
        val zone = ZoneId.of("Europe/Paris")
        assertEquals(ZonedDateTime.of(2026, 10, 1, 7, 0, 0, 0, zone), ReviewAlarm.nextTrigger(ZonedDateTime.of(2026, 10, 1, 6, 59, 0, 0, zone)))
        assertEquals(ZonedDateTime.of(2026, 10, 2, 7, 0, 0, 0, zone), ReviewAlarm.nextTrigger(ZonedDateTime.of(2026, 10, 1, 7, 0, 0, 0, zone)))
        // The clocks go back on 2026-10-25: the next 07:00 is still 07:00 local, 25 hours later.
        val next = ReviewAlarm.nextTrigger(ZonedDateTime.of(2026, 10, 24, 8, 0, 0, 0, zone))
        assertEquals(ZonedDateTime.of(2026, 10, 25, 7, 0, 0, 0, zone), next)
    }
}
