package com.ahmedmili.neoquiz.bridge

import com.ahmedmili.neoquiz.code.CodeProtocol
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Test

class CodeProtocolTest {
    private val host = CodeProtocol.HOST

    @Test fun onlyTheCodeOriginIsServed() {
        assertEquals("code/index.html", CodeProtocol.assetPathFor("https://$host/index.html"))
        assertEquals("code/pyodide/pyodide.asm.wasm", CodeProtocol.assetPathFor("https://$host/pyodide/pyodide.asm.wasm"))
        assertEquals("code/languages/c/clang/llvm.core.wasm", CodeProtocol.assetPathFor("https://$host/languages/c/clang/llvm.core.wasm?x=1"))
        for (u in listOf(
            "https://example.com/index.html",
            "https://appassets.androidplatform.net/assets/web/index.html", // the app's own origin
            "https://$host.evil.com/index.html",
            "https://evil.com@$host/index.html",
            "https://$host:8443/index.html",
            "http://$host/index.html",
            "file:///sdcard/x",
            "content://media/x",
            "data:text/html,x",
            "javascript:alert(1)",
            "wss://$host/index.html",
            "https://$host/",
            "https://$host",
            "not a url",
            "",
        )) assertNull(u, CodeProtocol.assetPathFor(u))
    }

    @Test fun pathsThatLeaveTheSandboxAreRefused() {
        for (p in listOf(
            "/../x", "/a/../x", "/%2e%2e/x", "/a/%2e%2e/x", "/a%2fb", "/a\\b", "/a%5cb", "/C:/x", "/x:y", "/index.html::$" + "DATA",
            "/.hidden", "/x.", "/a//b", "/nul", "/COM1.txt", "/a b", "/../../../etc/passwd",
        )) assertNull(p, CodeProtocol.assetPathFor("https://$host$p"))
    }

    @Test fun everyResponseCarriesTheSameCspAsThePc() {
        val h = CodeProtocol.headers()
        assertEquals("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'", h["Content-Security-Policy"])
        assertFalse(h["Content-Security-Policy"]!!.replace("wasm-unsafe-eval", "").contains("unsafe-eval"))
    }

    @Test fun mimeTypesLetWasmStream() {
        assertEquals("application/wasm", CodeProtocol.mimeFor("code/pyodide/pyodide.asm.wasm"))
        assertEquals("text/javascript", CodeProtocol.mimeFor("code/worker-python.mjs"))
        assertEquals("text/html", CodeProtocol.mimeFor("code/index.html"))
    }

    @Test fun jobsAreValidatedAndClampedLikeThePc() {
        val ok = CodeProtocol.parseJob(JSONObject("""{"language":"python","code":"print(1)","stdin":"","timeoutMs":999999}"""))
        assertNotNull(ok)
        assertEquals(10000, ok!!.timeoutMs)
        assertEquals(100, CodeProtocol.parseJob(JSONObject("""{"language":"c","code":"x","timeoutMs":1}"""))!!.timeoutMs)
        assertEquals(5000, CodeProtocol.parseJob(JSONObject("""{"language":"cpp","code":"x"}"""))!!.timeoutMs)
        assertNull(CodeProtocol.parseJob(JSONObject("""{"language":"ruby","code":"x"}""")))
        assertNull(CodeProtocol.parseJob(JSONObject("""{"language":"python","code":5}""")))
        assertNull(CodeProtocol.parseJob(JSONObject("""{"language":"python"}""")))
        assertNull(CodeProtocol.parseJob(JSONObject("""{"language":"python","code":"x","stdin":3}""")))
        assertNull(CodeProtocol.parseJob(JSONObject("""{"language":"python","code":"x","after":3}""")))
        assertNull(CodeProtocol.parseJob(JSONObject().put("language", "python").put("code", "x".repeat(64 * 1024 + 1))))
        assertNull(CodeProtocol.parseJob("python"))
        assertNull(CodeProtocol.parseJob(null))
    }

    @Test fun whatTheWorkerReturnsIsRebuiltFromAnAllowlist() {
        val r = CodeProtocol.normalise(JSONObject("""{"status":"ok","stdout":"2\n","extra":"x","constructor":1}"""))
        assertEquals(setOf("status", "stdout"), r.keys().asSequence().toSet())
        assertEquals("error", CodeProtocol.normalise(JSONObject("""{"status":"hacked"}""")).getString("status"))
        assertEquals("error", CodeProtocol.normalise(null).getString("status"))
        assertEquals(20000, CodeProtocol.normalise(JSONObject().put("status", "ok").put("stdout", "a".repeat(50000))).getString("stdout").length)
        assertEquals("boom", CodeProtocol.normalise(JSONObject("""{"status":"error","stdout":"","error":"boom"}""")).getString("error"))
        assertFalse(CodeProtocol.normalise(JSONObject("""{"status":"error","stdout":"","error":5}""")).has("error"))
    }
}
