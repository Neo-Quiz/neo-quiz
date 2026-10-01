package com.ahmedmili.neoquiz.sync

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirror of `scripts/check-electron-syncthing.mjs` (Task 6): the literals and
 * the cases are the same on purpose, so both platforms agree on what an id is
 * and what an offer may do.
 */
class ShareRulesTest {
    private val id = "CJXCUH3-SLWCMGX-7FKY3GZ-TAJCUWC-V5GKRYB-3APQ7CN-LPPVSJS-OZLDAQJ"

    // Produced by the real binary (`syncthing generate`): the oracle is Syncthing's own, not a copy of our rule.
    private val other = "XJ6SOIF-RNGCUTX-2KULCG5-CEH4D3K-YNQRMY6-JT7O5CR-XXML5WU-J5ZVOAH"
    private val key = "ab".repeat(32)

    @Test fun constants() {
        assertEquals("neo-quiz", ShareRules.FOLDER_ID)
        assertEquals(22100, ShareRules.LISTEN_PORT)
        assertEquals(21028, ShareRules.LOCAL_ANNOUNCE_PORT)
    }

    @Test fun isDeviceIdAcceptsTheRealFormatAndNothingElse() {
        assertTrue(ShareRules.isDeviceId(id))
        assertFalse(ShareRules.isDeviceId(id.lowercase()))
        assertFalse(ShareRules.isDeviceId(id.split("-").take(7).joinToString("-")))
        assertFalse(ShareRules.isDeviceId("$id-AAAAAAA"))
        assertFalse(ShareRules.isDeviceId("../../etc/passwd"))
        assertFalse(ShareRules.isDeviceId(id.replace("CJXCUH3", "CJXCUH0")))
        assertFalse(ShareRules.isDeviceId(id + "\n"))
        assertFalse(ShareRules.isDeviceId(id.replace("CJXCUH3", "CJXCUH")))
        assertFalse(ShareRules.isDeviceId(""))
        assertFalse(ShareRules.isDeviceId(null))
        assertFalse(ShareRules.isDeviceId(42))
    }

    @Test fun hasValidCheckDigits() {
        assertTrue(ShareRules.hasValidCheckDigits(id))
        val damaged = id.take(3) + (if (id[3] == 'A') 'B' else 'A') + id.drop(4)
        assertFalse(ShareRules.hasValidCheckDigits(damaged))
        assertTrue(ShareRules.hasValidCheckDigits(other))
    }

    @Test fun acceptOffer() {
        assertTrue(ShareRules.acceptOffer("neo-quiz", id, listOf(id)))
        assertFalse("unknown device", ShareRules.acceptOffer("neo-quiz", other, listOf(id)))
        assertFalse("another folder, even from a paired device", ShareRules.acceptOffer("default", id, listOf(id)))
        assertFalse("the folder id vault", ShareRules.acceptOffer("vault", id, listOf(id)))
        assertFalse("an id that merely contains ours", ShareRules.acceptOffer("neo-quiz-2", id, listOf(id)))
        assertFalse("nobody paired", ShareRules.acceptOffer("neo-quiz", id, emptyList()))
    }

    @Test fun requestsAreWellFormedUnknownDevicesWithATextOnlyName() {
        val bad = id.take(3) + (if (id[3] == 'A') 'B' else 'A') + id.drop(4)
        val pending = JSONObject()
            .put(other, JSONObject().put("name", "  Phone  ").put("address", "tcp://1.2.3.4:22000"))
            .put(id, JSONObject().put("name", "Already paired"))
            .put("not-an-id", JSONObject().put("name", "Forged"))
            .put(bad, JSONObject().put("name", "Bad check characters"))
        assertEquals(listOf(mapOf("id" to other, "nom" to "Phone")), ShareRules.requests(pending, listOf(id), "OWN"))
        assertEquals("paired or own: never a request", emptyList<Any>(), ShareRules.requests(JSONObject().put(other, JSONObject().put("name", "x")).put(id, JSONObject().put("name", "y")), listOf(other), id))
        assertEquals("cut to 64, control characters dropped", ("a<b>" + "z".repeat(100)).take(64),
            ShareRules.requests(JSONObject().put(other, JSONObject().put("name", "a\u0000<b>" + "z".repeat(100))), emptyList(), id)[0]["nom"])
        assertEquals("no name: the first 7 characters", other.take(7), ShareRules.requests(JSONObject().put(other, JSONObject()), emptyList(), id)[0]["nom"])
        assertEquals(emptyList<Any>(), ShareRules.requests(null, emptyList(), id))
    }

    @Test fun cleanNameDropsEverythingThatCouldForgeALineOrReorderText() {
        val hostile = "Eve" + listOf(10, 13, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069, 0x85).joinToString("") { Char(it).toString() } + "Device ID: " + id
        assertEquals(("EveDevice ID: " + id).take(64), ShareRules.cleanName(hostile))
        assertEquals("", ShareRules.cleanName(null))
        assertEquals(64, ShareRules.cleanName("y".repeat(99)).length)
        val shown = ShareRules.requests(JSONObject().put(other, JSONObject().put("name", hostile)), emptyList(), "OWN")[0]["nom"]!!
        assertTrue(shown.none { it.code in listOf(10, 13, 0x2028, 0x2029, 0x202e) })
    }

    @Test fun requestsAreNewestFirstAndTheCapSaysHowManyAreHidden() {
        val pending = JSONObject()
            .put(other, JSONObject().put("name", "old").put("time", "2026-10-01T08:00:00Z"))
            .put(id, JSONObject().put("name", "new").put("time", "2026-10-01T09:00:00Z"))
        assertEquals(listOf("new", "old"), ShareRules.requests(pending, emptyList(), "OWN").map { it["nom"] })
        assertEquals(0, ShareRules.requestsMore(pending, emptyList(), "OWN"))
        assertEquals(listOf("new"), ShareRules.requests(pending, emptyList(), "OWN", 1).map { it["nom"] })
        assertEquals(1, ShareRules.requestsMore(pending, emptyList(), "OWN", 1))
    }

    @Test fun lastSeenIsMillisecondsAndNeverIsNull() {
        assertEquals(java.time.Instant.parse("2026-10-01T10:00:00Z").toEpochMilli(), ShareRules.lastSeen("2026-10-01T10:00:00Z"))
        assertEquals(java.time.Instant.parse("2026-10-01T08:00:00Z").toEpochMilli(), ShareRules.lastSeen("2026-10-01T10:00:00+02:00"))
        assertEquals(null, ShareRules.lastSeen("0001-01-01T00:00:00Z"))
        assertEquals(null, ShareRules.lastSeen("1970-01-01T00:00:00Z"))
        assertEquals(null, ShareRules.lastSeen("nope"))
        assertEquals(null, ShareRules.lastSeen(null))
    }

    @Test fun theSharedPathIsAlwaysDocumentsNeoQuiz() {
        val documents = File("/storage/emulated/0/Documents")
        assertEquals(File(documents, "Neo Quiz"), ShareRules.sharedRoot(documents))
        // The offer's own path never reaches the config: folderConfig takes the pinned root only.
        val cfg = ShareRules.folderConfig("/storage/emulated/0/Documents/Neo Quiz", id, listOf(other, id, other))
        assertEquals("neo-quiz", cfg.getString("id"))
        assertEquals("/storage/emulated/0/Documents/Neo Quiz", cfg.getString("path"))
        val devices = cfg.getJSONArray("devices")
        assertEquals(listOf(id, other), (0 until devices.length()).map { devices.getJSONObject(it).getString("deviceID") })
        assertTrue(cfg.getBoolean("ignorePerms"))
    }

    @Test fun theCanonicalRootMustBeDocumentsNeoQuizItself() {
        val documents = File("/storage/emulated/0/Documents")
        assertTrue(ShareRules.isCanonicalSharedRoot(File("/storage/emulated/0/Documents/Neo Quiz"), documents))
        // A symlink Neo Quiz -> elsewhere resolves to somewhere else: sync refuses to start.
        assertFalse(ShareRules.isCanonicalSharedRoot(File("/storage/emulated/0/Download/other"), documents))
        assertFalse(ShareRules.isCanonicalSharedRoot(File("/storage/emulated/0/Documents"), documents))
        assertFalse(ShareRules.isCanonicalSharedRoot(File("/storage/emulated/0/Documents/Neo Quiz/sub"), documents))
        assertFalse(ShareRules.isCanonicalSharedRoot(File("/storage/emulated/0/Documents/Neo Quiz2"), documents))
    }

    @Test fun launchArgsIsExactlyTheVerifiedFlagList() {
        assertEquals(
            listOf("serve", "--home=/data/h", "--no-browser", "--no-restart", "--no-upgrade", "--gui-address=127.0.0.1:8384", "--gui-apikey=$key"),
            ShareRules.launchArgs("/data/h", 8384, key),
        )
        assertThrows(IllegalArgumentException::class.java) { ShareRules.launchArgs("/h", 80, key) }
        assertThrows(IllegalArgumentException::class.java) { ShareRules.launchArgs("/h", 70000, key) }
        assertThrows(IllegalArgumentException::class.java) { ShareRules.launchArgs("/h", 8384, "short") }
        assertThrows(IllegalArgumentException::class.java) { ShareRules.launchArgs("/h", 8384, "zz".repeat(32)) }
        assertThrows(IllegalArgumentException::class.java) { ShareRules.launchArgs("", 8384, key) }
    }

    @Test fun launchEnvStripsStVariablesAndPinsNoUpgrade() {
        val env = ShareRules.launchEnv(mapOf("PATH" to "x", "STGUIADDRESS" to "0.0.0.0:1", "STHOMEDIR" to "/o", "ANDROID_ROOT" to "/system", "STNOUPGRADE" to "0"))
        assertEquals(mapOf("PATH" to "x", "ANDROID_ROOT" to "/system", "STNOUPGRADE" to "1"), env)
    }

    @Test fun listenAddressesAndFixedOptions() {
        assertEquals(listOf("tcp://:22100", "quic://:22100", "dynamic+https://relays.syncthing.net/endpoint"), ShareRules.listenAddresses(true))
        assertEquals(listOf("tcp://:0", "quic://:0", "dynamic+https://relays.syncthing.net/endpoint"), ShareRules.listenAddresses(false))
        val o = ShareRules.fixedOptions(true)
        assertEquals(21028, o.getInt("localAnnouncePort"))
        assertEquals("[ff12::8384]:21028", o.getString("localAnnounceMCAddr"))
        assertEquals(-1, o.getInt("urAccepted"))
        assertFalse(o.getBoolean("startBrowser"))
        assertFalse(o.getBoolean("crashReportingEnabled"))
        assertEquals(0, o.getInt("autoUpgradeIntervalH"))
    }

    @Test fun folderState() {
        fun st(s: String, g: Long = 0, i: Long = 0) = JSONObject().put("state", s).put("globalBytes", g).put("inSyncBytes", i)
        assertEquals(FolderState("idle", null), ShareRules.folderState(st("idle", 10, 10)))
        assertEquals(FolderState("syncing", 25), ShareRules.folderState(st("syncing", 200, 50)))
        assertEquals(FolderState("syncing", null), ShareRules.folderState(st("sync-preparing")))
        assertEquals(FolderState("error", null), ShareRules.folderState(st("error")))
        assertEquals("scanning is not syncing", "idle", ShareRules.folderState(st("scanning", 1, 1)).state)
        assertEquals(FolderState("absent", null), ShareRules.folderState(null))
    }

    private fun ev(type: String, vararg data: Pair<String, Any?>) = JSONObject().put("type", type).put("data", JSONObject(data.toMap()))

    @Test fun receptionDetectorFiresOnlyAfterRemoteItemsThenIdle() {
        val folder = "folder" to "neo-quiz"
        var d = ReceptionDetector()
        assertFalse(d.observe(ev("ItemFinished", folder, "item" to "a.md")))
        assertTrue(d.observe(ev("StateChanged", folder, "to" to "idle")))
        assertFalse("fires once", d.observe(ev("StateChanged", folder, "to" to "idle")))
        d = ReceptionDetector()
        assertFalse("a local scan ending idle with nothing armed", d.observe(ev("StateChanged", folder, "to" to "idle")))
        d = ReceptionDetector()
        d.observe(ev("ItemFinished", folder, "error" to "boom"))
        assertFalse("an errored item does not arm", d.observe(ev("StateChanged", folder, "to" to "idle")))
        d = ReceptionDetector()
        d.observe(ev("ItemFinished", "folder" to "other"))
        assertFalse("another folder never arms", d.observe(ev("StateChanged", "folder" to "other", "to" to "idle")))
        d = ReceptionDetector()
        d.observe(ev("ItemFinished", folder))
        assertFalse("not idle yet", d.observe(ev("StateChanged", folder, "to" to "syncing")))
        assertTrue(d.observe(ev("StateChanged", folder, "to" to "idle")))
    }
}
