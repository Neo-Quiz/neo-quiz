package com.ahmedmili.neoquiz.bridge

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ClipboardChannelTest {
    @Test fun copiesTheTextAndRefusesAHugeOne() {
        var got: String? = null
        val h = ClipboardChannel { got = it }.handlers().getValue("systeme.copierTexte")
        runBlocking { h(JSONArray().put("3R7WSX2-LSDT25I")) }
        assertEquals("3R7WSX2-LSDT25I", got)
        assertThrows(IllegalArgumentException::class.java) { runBlocking { h(JSONArray().put("x".repeat(1_000_001))) } }
    }
}
