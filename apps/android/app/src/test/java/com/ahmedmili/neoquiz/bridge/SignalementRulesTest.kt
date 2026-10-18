package com.ahmedmili.neoquiz.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SignalementRulesTest {
    private val relay = "https://relay.example.workers.dev"

    @Test fun `https relay and github hosts accepted`() {
        assertTrue(SignalementRules.isAllowedHost("https://relay.example.workers.dev/report", relay))
        assertTrue(SignalementRules.isAllowedHost("https://github.com/login/device/code", relay))
        assertTrue(SignalementRules.isAllowedHost("https://api.github.com/user", relay))
        assertTrue(SignalementRules.isAllowedHost("https://GitHub.com/login/device", relay))
    }

    @Test fun `http, other host, userinfo, port 8443 refused`() {
        assertFalse(SignalementRules.isAllowedHost("http://github.com/x", relay))
        assertFalse(SignalementRules.isAllowedHost("https://evil.example/x", relay))
        assertFalse(SignalementRules.isAllowedHost("https://github.com.evil.example/x", relay))
        assertFalse(SignalementRules.isAllowedHost("https://user:pw@github.com/x", relay))
        assertFalse(SignalementRules.isAllowedHost("https://github.com:8443/x", relay))
        assertFalse(SignalementRules.isAllowedHost("https://github.com/x", "http://relay.example"))
        assertFalse(SignalementRules.isAllowedHost("not a url", relay))
    }

    @Test fun `a plain report is accepted`() {
        assertTrue(SignalementRules.acceptsBody("""{"v":1,"what":"It crashed","env":{"app":"1","os":"Android 15","platform":"android"}}"""))
    }

    @Test fun `body of 16385 bytes refused`() {
        val head = """{"v":1,"what":"x","log":""""
        val tail = "\"}"
        val pad = "a".repeat(16385 - head.length - tail.length)
        assertEquals(16385, (head + pad + tail).toByteArray().size)
        assertFalse(SignalementRules.acceptsBody(head + pad + tail))
        assertTrue(SignalementRules.acceptsBody(head + pad.dropLast(1) + tail))
    }

    @Test fun `unknown key refused`() {
        assertFalse(SignalementRules.acceptsBody("""{"v":1,"what":"x","extra":1}"""))
    }

    @Test fun `v=2 refused`() {
        assertFalse(SignalementRules.acceptsBody("""{"v":2,"what":"x"}"""))
        assertFalse(SignalementRules.acceptsBody("""{"what":"x"}"""))
    }

    @Test fun `blank what refused`() {
        assertFalse(SignalementRules.acceptsBody("""{"v":1,"what":"   "}"""))
        assertFalse(SignalementRules.acceptsBody("""{"v":1}"""))
        assertFalse(SignalementRules.acceptsBody("not json"))
    }

    @Test fun `slow_down adds 5000 ms`() {
        assertEquals(5000L, SignalementRules.deviceFlowDelayMs(5, false))
        assertEquals(10000L, SignalementRules.deviceFlowDelayMs(5, true))
        assertEquals(5000L, SignalementRules.deviceFlowDelayMs(0, false))
    }
}
