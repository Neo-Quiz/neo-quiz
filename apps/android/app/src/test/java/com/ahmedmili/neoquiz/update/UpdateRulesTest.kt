package com.ahmedmili.neoquiz.update

import com.ahmedmili.neoquiz.code.LanguagePacks
import java.io.ByteArrayInputStream
import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val sha = "a".repeat(64)
    private fun url(tag: String = "0.2.0", file: String = "0.2.0") =
        "https://github.com/Neo-Quiz/neo-quiz/releases/download/android-v$tag/NeoQuiz-$file.apk"

    private fun manifest(vararg overrides: Pair<String, Any?>): String {
        val o = JSONObject()
            .put("versionCode", 2).put("versionName", "0.2.0").put("url", url())
            .put("sha256", sha).put("size", 1000).put("notes", "Fixes.")
        for ((k, v) in overrides) if (v == null) o.remove(k) else o.put(k, v)
        return o.toString()
    }

    @Test fun acceptsAGoodManifest() {
        val m = UpdateRules.parse(manifest())
        assertEquals(2, m.versionCode)
        assertEquals("0.2.0", m.versionName)
        assertEquals(1000L, m.size)
    }

    @Test fun refusesAWrongHost() {
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("github.com", "evil.example"))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("https://", "http://"))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("https://github.com", "https://github.com.evil.example"))) }
    }

    @Test fun refusesAWrongPathPattern() {
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("Neo-Quiz/neo-quiz", "someone/else"))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("android-v", "desktop-v"))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url() + "?x=1")) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url().replace("NeoQuiz-", "Other-"))) }
    }

    @Test fun refusesAVersionNameThatDoesNotMatchTheTag() {
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("versionName" to "0.3.0")) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url(tag = "0.1.9", file = "0.2.0"))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to url(tag = "0.2.0", file = "0.2.1"))) }
    }

    @Test fun refusesAnOversizeApk() {
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("size" to UpdateRules.APK_MAX_BYTES + 1)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("size" to 0)) }
    }

    @Test fun refusesBadTypes() {
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("versionCode" to "2")) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("versionCode" to 2.5)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("versionCode" to 0)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("versionName" to 2)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("sha256" to "A".repeat(64))) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("sha256" to "abc")) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("size" to "1000")) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("notes" to 5)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse(manifest("url" to null)) }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse("[1]") }
        assertThrows(UpdateRefused::class.java) { UpdateRules.parse("not json") }
    }

    @Test fun comparesVersionCodes() {
        val m = UpdateRules.parse(manifest())
        assertTrue(UpdateRules.isNewer(1, m))
        assertFalse(UpdateRules.isNewer(2, m))
        assertFalse(UpdateRules.isNewer(3, m))
    }

    @Test fun checksAreAtMostEverySixHours() {
        val six = UpdateRules.CHECK_INTERVAL_MS
        assertTrue(UpdateRules.due(0, 1000))
        assertFalse(UpdateRules.due(1000, 1000 + six - 1))
        assertTrue(UpdateRules.due(1000, 1000 + six))
        assertTrue(UpdateRules.due(5000, 1000)) // clock set back
    }

    @Test fun manifestHostIsTheSiteOnly() {
        assertTrue(UpdateRules.manifestUrlAllowed(UpdateRules.MANIFEST_URL))
        assertFalse(UpdateRules.manifestUrlAllowed("https://github.com/x"))
        assertFalse(UpdateRules.manifestUrlAllowed("http://neo-quiz.github.io/android-latest.json"))
        assertFalse(UpdateRules.manifestUrlAllowed("https://neo-quiz.github.io.evil.example/a"))
        assertFalse(UpdateRules.manifestUrlAllowed("https://user@neo-quiz.github.io/a"))
        assertFalse(UpdateRules.manifestUrlAllowed("https://neo-quiz.github.io:8443/a"))
    }

    @Test fun aManifestRedirectOffTheSiteIsRefusedBeforeItIsRequested() {
        val requested = mutableListOf<String>()
        val e = assertThrows(IOException::class.java) {
            LanguagePacks.follow(UpdateRules.MANIFEST_URL, UpdateRules::manifestUrlAllowed) { u ->
                requested += u
                LanguagePacks.Hop(302, "https://evil.example/android-latest.json", null)
            }
        }
        assertEquals(listOf(UpdateRules.MANIFEST_URL), requested)
        assertTrue(e.message!!.contains("outside the list"))
    }

    @Test fun anApkRedirectOffTheReleaseHostsIsRefused() {
        val requested = mutableListOf<String>()
        assertThrows(IOException::class.java) {
            LanguagePacks.follow(url(), UpdateRules::apkUrlAllowed) { u ->
                requested += u
                if (u == url()) LanguagePacks.Hop(302, "https://objects.githubusercontent.com/a", null)
                else LanguagePacks.Hop(302, "https://evil.example/a.apk", null)
            }
        }
        assertEquals(2, requested.size)
    }

    @Test fun anOversizeManifestBodyIsCut() {
        val big = ByteArray(UpdateRules.MANIFEST_MAX_BYTES + 1) { 'x'.code.toByte() }
        assertThrows(UpdateRefused::class.java) { UpdateDownload.readManifest({ ByteArrayInputStream(big) }) }
    }
}
