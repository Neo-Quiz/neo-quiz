package com.ahmedmili.neoquiz.bridge

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BugReportChannelTest {
    private class Store(var session: GithubSession? = null) : SessionStore {
        override fun read() = session
        override fun write(session: GithubSession) { this.session = session }
        override fun clear() { session = null }
    }

    private val relay = "https://relay.example.workers.dev"
    private val calls = mutableListOf<Pair<String, JSONObject?>>()
    private var clock = 1_000_000L

    private fun channel(
        store: SessionStore,
        relayUrl: String = relay,
        clientId: String = "Iv1.abc",
        pause: suspend (Long, CompletableDeferred<Unit>) -> Unit = { _, _ -> },
        http: BugReportHttp,
    ) =
        BugReportChannel(
            CoroutineScope(Dispatchers.Default), store, http, { JSONObject().put("app", "9.9").put("os", "Android 15").put("platform", "android") },
            relayUrl, clientId, { clock }, pause,
        ).handlers()

    private fun call(h: Map<String, suspend (JSONArray) -> Any?>, name: String, vararg args: Any?): Any? =
        runBlocking { h.getValue(name)(JSONArray(args.toList())) }

    private fun report() = JSONObject("""{"v":1,"what":"It crashed","env":{"app":"evil","os":"evil","platform":"windows"},"log":"leak","githubToken":"forged"}""")

    @Test fun `disabled while a constant is empty`() {
        val h = channel(Store(), relayUrl = "") { _, _, _, _ -> error("no network") }
        assertEquals("disabled", (call(h, "bugReport.preview") as JSONObject).getString("code"))
        assertEquals("disabled", (call(h, "bugReport.send", report()) as JSONObject).getString("code"))
        assertEquals("disabled", (call(h, "bugReport.github.connect") as JSONObject).getString("code"))
    }

    @Test fun `preview gives the own environment and no log`() {
        val a = call(channel(Store()) { _, _, _, _ -> error("no network") }, "bugReport.preview") as JSONObject
        assertTrue(a.getBoolean("ok"))
        assertEquals("android", a.getJSONObject("env").getString("platform"))
        assertEquals("", a.getString("log"))
    }

    @Test fun `send replaces env, drops the forged token and the log`() {
        val sent = mutableListOf<JSONObject>()
        val h = channel(Store()) { _, url, _, body ->
            assertEquals("$relay/report", url)
            sent += JSONObject(body!!)
            JSONObject("""{"ok":true,"url":"https://github.com/o/r/issues/7","number":7}""")
        }
        val r = call(h, "bugReport.send", report()) as JSONObject
        assertEquals(7, r.getInt("number"))
        assertFalse(sent[0].has("githubToken"))
        assertFalse(sent[0].has("log"))
        assertEquals("9.9", sent[0].getJSONObject("env").getString("app"))
    }

    @Test fun `send without an env key sends no env`() {
        val sent = mutableListOf<JSONObject>()
        val h = channel(Store()) { _, _, _, body ->
            sent += JSONObject(body!!)
            JSONObject("""{"ok":true,"url":"https://github.com/o/r/issues/7","number":7}""")
        }
        val r = call(h, "bugReport.send", JSONObject("""{"v":1,"what":"It crashed"}""")) as JSONObject
        assertEquals(7, r.getInt("number"))
        assertFalse(sent[0].has("env"))
    }

    @Test fun `second send within 5 seconds is rate limited`() {
        val h = channel(Store()) { _, _, _, _ -> JSONObject("""{"ok":false,"code":"duplicate"}""") }
        assertEquals("duplicate", (call(h, "bugReport.send", report()) as JSONObject).getString("code"))
        assertEquals("rate_limited", (call(h, "bugReport.send", report()) as JSONObject).getString("code"))
        clock += 5001
        assertEquals("duplicate", (call(h, "bugReport.send", report()) as JSONObject).getString("code"))
    }

    @Test fun `token_invalid erases the session and retries once anonymously`() {
        val store = Store(GithubSession("tok", "octo"))
        val tokens = mutableListOf<Boolean>()
        val h = channel(store) { _, _, _, body ->
            val has = JSONObject(body!!).has("githubToken")
            tokens += has
            if (has) JSONObject("""{"ok":false,"code":"token_invalid"}""") else JSONObject("""{"ok":true,"url":"https://github.com/o/r/issues/1","number":1}""")
        }
        assertTrue((call(h, "bugReport.send", report()) as JSONObject).getBoolean("ok"))
        assertEquals(listOf(true, false), tokens)
        assertNull(store.session)
    }

    @Test fun `a foreign issue url is an upstream error and a redirect-like failure too`() {
        val h = channel(Store()) { _, _, _, _ -> JSONObject("""{"ok":true,"url":"https://evil.example/x","number":1}""") }
        assertEquals("upstream", (call(h, "bugReport.send", report()) as JSONObject).getString("code"))
    }

    @Test fun `device flow stores the session and returns the login only`() {
        val store = Store()
        var polls = 0
        val h = channel(store) { method, url, _, _ ->
            when (url) {
                "https://github.com/login/device/code" -> JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                "https://github.com/login/oauth/access_token" -> if (polls++ == 0) JSONObject("""{"error":"slow_down"}""") else JSONObject("""{"access_token":"secret-token"}""")
                "https://api.github.com/user" -> { assertEquals("GET", method); JSONObject("""{"login":"octo"}""") }
                else -> error(url)
            }
        }
        val c = call(h, "bugReport.github.connect") as JSONObject
        assertEquals("ABCD-1234", c.getString("userCode"))
        assertEquals("busy", (call(h, "bugReport.github.connect") as JSONObject).getString("code"))
        val a = call(h, "bugReport.github.wait") as JSONObject
        assertEquals("octo", a.getString("login"))
        assertFalse(a.toString().contains("secret-token"))
        assertEquals("secret-token", store.session?.accessToken)
        assertEquals("octo", (call(h, "bugReport.github.state") as JSONObject).getString("login"))
        call(h, "bugReport.github.disconnect")
        assertNull(call(h, "bugReport.github.state"))
    }

    @Test fun `a verification host outside the rule is refused`() {
        val h = channel(Store()) { _, _, _, _ ->
            JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://evil.example/device","expires_in":900}""")
        }
        assertEquals("refused", (call(h, "bugReport.github.connect") as JSONObject).getString("code"))
    }

    @Test fun `disconnect wins over a late wait and writes no session`() {
        val store = Store()
        val reachedUser = CountDownLatch(1)
        val released = CountDownLatch(1)
        val h = channel(store) { _, url, _, _ ->
            when (url) {
                "https://github.com/login/device/code" -> JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                "https://github.com/login/oauth/access_token" -> JSONObject("""{"access_token":"secret-token"}""")
                "https://api.github.com/user" -> {
                    reachedUser.countDown()
                    assertTrue(released.await(10, TimeUnit.SECONDS))
                    JSONObject("""{"login":"octo"}""")
                }
                else -> error(url)
            }
        }
        call(h, "bugReport.github.connect")
        val answer = AtomicReference<JSONObject>()
        val waiter = Thread { runBlocking { answer.set(call(h, "bugReport.github.wait") as JSONObject) } }
        waiter.start()
        assertTrue(reachedUser.await(10, TimeUnit.SECONDS))
        call(h, "bugReport.github.disconnect")
        released.countDown()
        waiter.join(10_000)
        val r = answer.get()
        assertNotNull(r)
        assertEquals("cancelled", r!!.getString("error"))
        assertFalse(r.toString().contains("secret-token"))
        assertNull(store.session)
    }

    @Test fun `a flow left past its expiry is free again`() {
        var codes = 0
        val h = channel(Store()) { _, url, _, _ ->
            when (url) {
                "https://github.com/login/device/code" -> {
                    codes++
                    JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                }
                else -> error(url)
            }
        }
        assertEquals("ABCD-1234", (call(h, "bugReport.github.connect") as JSONObject).getString("userCode"))
        assertEquals("busy", (call(h, "bugReport.github.connect") as JSONObject).getString("code"))
        clock += 900_001
        assertEquals("ABCD-1234", (call(h, "bugReport.github.connect") as JSONObject).getString("userCode"))
        assertEquals(2, codes)
    }

    @Test fun `wait reports expired once the flow is past its limit`() {
        val h = channel(Store()) { _, url, _, _ ->
            when (url) {
                "https://github.com/login/device/code" -> JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                else -> error(url) // the poll must stop before asking for a token
            }
        }
        call(h, "bugReport.github.connect")
        clock += 900_001
        assertEquals("expired", (call(h, "bugReport.github.wait") as JSONObject).getString("error"))
    }

    @Test fun `wait reports a denial as denied and an expired token as expired`() {
        var tokenError = "access_denied"
        val h = channel(Store()) { _, url, _, _ ->
            when (url) {
                "https://github.com/login/device/code" -> JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                "https://github.com/login/oauth/access_token" -> JSONObject("""{"error":"$tokenError"}""")
                else -> error(url)
            }
        }
        call(h, "bugReport.github.connect")
        assertEquals("denied", (call(h, "bugReport.github.wait") as JSONObject).getString("error"))
        tokenError = "expired_token"
        call(h, "bugReport.github.connect")
        assertEquals("expired", (call(h, "bugReport.github.wait") as JSONObject).getString("error"))
    }

    @Test fun `cancel during the poll reports cancelled and writes no session`() {
        val store = Store()
        val paused = CountDownLatch(1)
        val h = channel(
            store,
            http = { _, url, _, _ ->
                when (url) {
                    "https://github.com/login/device/code" -> JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}""")
                    else -> error(url)
                }
            },
            pause = { _, abort ->
                paused.countDown()
                abort.await()
            },
        )
        call(h, "bugReport.github.connect")
        val answer = AtomicReference<JSONObject>()
        val waiter = Thread { runBlocking { answer.set(call(h, "bugReport.github.wait") as JSONObject) } }
        waiter.start()
        assertTrue(paused.await(10, TimeUnit.SECONDS))
        call(h, "bugReport.github.cancel")
        waiter.join(10_000)
        val r = answer.get()
        assertNotNull(r)
        assertEquals("cancelled", r!!.getString("error"))
        assertNull(store.session)
    }
}
