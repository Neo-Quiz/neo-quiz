package com.ahmedmili.neoquiz.bridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SignalementChannelTest {
    private class Store(var session: GithubSession? = null) : SessionStore {
        override fun read() = session
        override fun write(session: GithubSession) { this.session = session }
        override fun clear() { session = null }
    }

    private val relay = "https://relay.example.workers.dev"
    private val calls = mutableListOf<Pair<String, JSONObject?>>()
    private var clock = 1_000_000L

    private fun channel(store: SessionStore, relayUrl: String = relay, clientId: String = "Iv1.abc", http: SignalementHttp) =
        SignalementChannel(
            CoroutineScope(Dispatchers.Default), store, http, { JSONObject().put("app", "9.9").put("os", "Android 15").put("platform", "android") },
            relayUrl, clientId, { clock }, { _, _ -> },
        ).handlers()

    private fun call(h: Map<String, suspend (JSONArray) -> Any?>, name: String, vararg args: Any?): Any? =
        runBlocking { h.getValue(name)(JSONArray(args.toList())) }

    private fun report() = JSONObject("""{"v":1,"what":"It crashed","log":"leak","githubToken":"forged"}""")

    @Test fun `disabled while a constant is empty`() {
        val h = channel(Store(), relayUrl = "") { _, _, _, _ -> error("no network") }
        assertEquals("disabled", (call(h, "signalement.apercu") as JSONObject).getString("code"))
        assertEquals("disabled", (call(h, "signalement.envoyer", report()) as JSONObject).getString("code"))
        assertEquals("disabled", (call(h, "signalement.github.connecter") as JSONObject).getString("code"))
    }

    @Test fun `apercu gives the own environment and no log`() {
        val a = call(channel(Store()) { _, _, _, _ -> error("no network") }, "signalement.apercu") as JSONObject
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
        val r = call(h, "signalement.envoyer", report()) as JSONObject
        assertEquals(7, r.getInt("number"))
        assertFalse(sent[0].has("githubToken"))
        assertFalse(sent[0].has("log"))
        assertEquals("9.9", sent[0].getJSONObject("env").getString("app"))
    }

    @Test fun `second send within 5 seconds is rate limited`() {
        val h = channel(Store()) { _, _, _, _ -> JSONObject("""{"ok":false,"code":"duplicate"}""") }
        assertEquals("duplicate", (call(h, "signalement.envoyer", report()) as JSONObject).getString("code"))
        assertEquals("rate_limited", (call(h, "signalement.envoyer", report()) as JSONObject).getString("code"))
        clock += 5001
        assertEquals("duplicate", (call(h, "signalement.envoyer", report()) as JSONObject).getString("code"))
    }

    @Test fun `token_invalid erases the session and retries once anonymously`() {
        val store = Store(GithubSession("tok", "octo"))
        val tokens = mutableListOf<Boolean>()
        val h = channel(store) { _, _, _, body ->
            val has = JSONObject(body!!).has("githubToken")
            tokens += has
            if (has) JSONObject("""{"ok":false,"code":"token_invalid"}""") else JSONObject("""{"ok":true,"url":"https://github.com/o/r/issues/1","number":1}""")
        }
        assertTrue((call(h, "signalement.envoyer", report()) as JSONObject).getBoolean("ok"))
        assertEquals(listOf(true, false), tokens)
        assertNull(store.session)
    }

    @Test fun `a foreign issue url is an upstream error and a redirect-like failure too`() {
        val h = channel(Store()) { _, _, _, _ -> JSONObject("""{"ok":true,"url":"https://evil.example/x","number":1}""") }
        assertEquals("upstream", (call(h, "signalement.envoyer", report()) as JSONObject).getString("code"))
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
        val c = call(h, "signalement.github.connecter") as JSONObject
        assertEquals("ABCD-1234", c.getString("userCode"))
        assertEquals("busy", (call(h, "signalement.github.connecter") as JSONObject).getString("code"))
        val a = call(h, "signalement.github.attendre") as JSONObject
        assertEquals("octo", a.getString("login"))
        assertFalse(a.toString().contains("secret-token"))
        assertEquals("secret-token", store.session?.accessToken)
        assertEquals("octo", (call(h, "signalement.github.etat") as JSONObject).getString("login"))
        call(h, "signalement.github.deconnecter")
        assertNull(call(h, "signalement.github.etat"))
    }

    @Test fun `a verification host outside the rule is refused`() {
        val h = channel(Store()) { _, _, _, _ ->
            JSONObject("""{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://evil.example/device","expires_in":900}""")
        }
        assertEquals("refused", (call(h, "signalement.github.connecter") as JSONObject).getString("code"))
    }
}
