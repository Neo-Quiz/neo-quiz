package com.ahmedmili.neoquiz.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BugReportRulesTest {
    private val relay = "https://relay.example.workers.dev"

    @Test fun `https relay and github hosts accepted`() {
        assertTrue(BugReportRules.isAllowedHost("https://relay.example.workers.dev/report", relay))
        assertTrue(BugReportRules.isAllowedHost("https://github.com/login/device/code", relay))
        assertTrue(BugReportRules.isAllowedHost("https://api.github.com/user", relay))
        assertTrue(BugReportRules.isAllowedHost("https://GitHub.com/login/device", relay))
    }

    @Test fun `http, other host, userinfo, port 8443 refused`() {
        assertFalse(BugReportRules.isAllowedHost("http://github.com/x", relay))
        assertFalse(BugReportRules.isAllowedHost("https://evil.example/x", relay))
        assertFalse(BugReportRules.isAllowedHost("https://github.com.evil.example/x", relay))
        assertFalse(BugReportRules.isAllowedHost("https://user:pw@github.com/x", relay))
        assertFalse(BugReportRules.isAllowedHost("https://github.com:8443/x", relay))
        assertFalse(BugReportRules.isAllowedHost("https://github.com/x", "http://relay.example"))
        assertFalse(BugReportRules.isAllowedHost("not a url", relay))
    }

    @Test fun `a plain report is accepted`() {
        assertTrue(BugReportRules.acceptsBody("""{"v":1,"what":"It crashed","env":{"app":"1","os":"Android 15","platform":"android"}}"""))
    }

    @Test fun `body of 16385 bytes refused`() {
        val head = """{"v":1,"what":"x","log":""""
        val tail = "\"}"
        val pad = "a".repeat(16385 - head.length - tail.length)
        assertEquals(16385, (head + pad + tail).toByteArray().size)
        assertFalse(BugReportRules.acceptsBody(head + pad + tail))
        assertTrue(BugReportRules.acceptsBody(head + pad.dropLast(1) + tail))
    }

    @Test fun `unknown key refused`() {
        assertFalse(BugReportRules.acceptsBody("""{"v":1,"what":"x","extra":1}"""))
    }

    @Test fun `v=2 refused`() {
        assertFalse(BugReportRules.acceptsBody("""{"v":2,"what":"x"}"""))
        assertFalse(BugReportRules.acceptsBody("""{"what":"x"}"""))
    }

    @Test fun `blank what refused`() {
        assertFalse(BugReportRules.acceptsBody("""{"v":1,"what":"   "}"""))
        assertFalse(BugReportRules.acceptsBody("""{"v":1}"""))
        assertFalse(BugReportRules.acceptsBody("not json"))
    }

    @Test fun `slow_down adds 5000 ms`() {
        assertEquals(5000L, BugReportRules.deviceFlowDelayMs(5, false))
        assertEquals(10000L, BugReportRules.deviceFlowDelayMs(5, true))
        assertEquals(5000L, BugReportRules.deviceFlowDelayMs(0, false))
    }
}
