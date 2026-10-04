package com.ahmedmili.neoquiz.sync

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** What the Sync page shows of the folder: `idle` / `syncing` / `error` / `absent`, and a percentage while syncing. */
data class FolderState(val state: String, val percent: Int?)

/**
 * THE RULES OF THE EMBEDDED SYNCTHING, mirror of
 * `apps/windows/electron/syncthing-regles.ts` (Task 6). Pure: no Android
 * class, so the JVM tests break each rule and watch it fail.
 *
 * - one folder only ([FOLDER_ID]), always at `/storage/emulated/0/Neo Quiz` ([sharedRoot]),
 *   never at a path that came from an offer or from the renderer;
 * - a device is a device the owner PAIRED: an offer from anybody else is ignored;
 * - a device id coming from the page is validated (format AND the Luhn check
 *   characters Syncthing writes into every id) before it reaches a config;
 * - the launch arguments carry nothing but their parameters, and the
 *   environment is cleaned of every `ST*` variable (Syncthing reads
 *   `STGUIADDRESS`, `STHOMEDIR`... from it).
 *
 * The literals (`isDeviceId`, `acceptOffer`, ports, ignore lines, options) are
 * the same as the Windows file on purpose: both platforms must agree.
 */
object ShareRules {
    const val FOLDER_ID = "neo-quiz"

    /** TCP and QUIC port of this app's Syncthing; the owner's personal Syncthing-Fork keeps 22000. */
    const val LISTEN_PORT = 22100

    /**
     * UDP port of this app's local discovery. Syncthing's default (21027) is
     * the one the owner's personal Syncthing-Fork binds on the same phone; two
     * instances cannot share it. Every Neo Quiz instance (PC and Android)
     * uses this one, so they still find each other on the LAN.
     */
    const val LOCAL_ANNOUNCE_PORT = 21028

    /** Lines of the folder's `.stignore`: conflict copies under `.neo-quiz/` are the app's to merge, never to propagate. */
    val IGNORES: List<String> = listOf("(?d).neo-quiz/**/*.sync-conflict-*", "(?d).trash")

    private const val DYNAMIC_RELAY = "dynamic+https://relays.syncthing.net/endpoint"
    private val ID_FORMAT = Regex("^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$")
    private val API_KEY = Regex("^[0-9a-f]{64}$")
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /** The shared folder: `Neo Quiz` at the root of the shared [storage] (`/storage/emulated/0`, like
        Neo Calendar's, 2026-10-04; `Documents/Neo Quiz` before, see [FolderMove]), whatever an offer or the page says. */
    fun sharedRoot(storage: File): File = File(storage, "Neo Quiz")

    /** True when [real] (resolved on the disk) is exactly `Neo Quiz` directly under the resolved [storage]: a symlink pointing elsewhere is not. */
    fun isCanonicalSharedRoot(real: File, storage: File): Boolean = real == sharedRoot(storage)

    /**
     * The device id and announced name a SCANNED QR code carries: Neo Quiz's
     * `neo-quiz://pair?device=<id>&name=<name>` (any `code` ignored here) or a bare id, in any
     * grouping. `null` when the text holds no valid-looking id. The name is cleaned.
     */
    fun scannedPairing(text: String?): Pair<String, String>? {
        val t = text?.trim() ?: return null
        var raw = t
        var name = ""
        val link = PAIR_LINK.find(t)
        if (link != null) {
            val params = link.groupValues[1].split("&").mapNotNull { p ->
                p.split("=", limit = 2).takeIf { it.size == 2 }?.let { decodeParam(it[0]) to decodeParam(it[1]) }
            }.toMap()
            raw = params["device"] ?: return null
            name = cleanName(params["name"])
        }
        val bare = raw.replace(Regex("[\\s-]+"), "").uppercase()
        val id = if (bare.length == 56) bare.chunked(7).joinToString("-") else raw.uppercase()
        return if (isDeviceId(id)) id to name else null
    }

    private val PAIR_LINK = Regex("^neo-quiz://pair\\?(.*)$", RegexOption.IGNORE_CASE)

    private fun decodeParam(s: String): String = try { java.net.URLDecoder.decode(s, "UTF-8") } catch (_: Exception) { "" }

    /**
     * The config's `remoteIgnoredDevices` with [id] added (Ignore on a request: Syncthing then stops
     * showing it, where dismissing the pending entry alone let it come back at the next connection
     * attempt, 2026-10-04) or removed (paired after all). Other entries are kept.
     */
    fun withIgnored(list: JSONArray?, id: String, ignore: Boolean, now: String): JSONArray {
        val out = JSONArray()
        if (list != null) for (i in 0 until list.length()) {
            val d = list.optJSONObject(i) ?: continue
            if (d.optString("deviceID") != id) out.put(d)
        }
        if (ignore) out.put(JSONObject().put("deviceID", id).put("name", "").put("address", "").put("time", now))
        return out
    }

    /** How long a pairing request waits for Accept before it is ignored on its own (2026-10-04). */
    const val REQUEST_TIMEOUT_MS = 2 * 60_000L

    /**
     * Keeps [firstSeen] (device id -> first time its request was seen) in step with [pending] and
     * returns the ids whose request has waited [REQUEST_TIMEOUT_MS] or more. A request that went
     * away is forgotten, so the same device asking again later gets the full time again.
     */
    fun expiredRequests(pending: JSONObject?, firstSeen: MutableMap<String, Long>, now: Long): List<String> {
        val ids = pending?.keys()?.asSequence()?.toList() ?: emptyList()
        firstSeen.keys.retainAll(ids.toSet())
        val out = mutableListOf<String>()
        for (id in ids) {
            val start = firstSeen[id]
            if (start == null) firstSeen[id] = now else if (now - start >= REQUEST_TIMEOUT_MS) out.add(id)
        }
        return out
    }

    fun isIgnored(list: JSONArray?, id: String): Boolean =
        list != null && (0 until list.length()).any { list.optJSONObject(it)?.optString("deviceID") == id }

    /** `\A`..`\z`-style match: Kotlin's `matches` is anchored at both ends, so a trailing newline fails. */
    fun isDeviceId(s: Any?): Boolean = s is String && ID_FORMAT.matches(s)

    /** Syncthing's Luhn-32 check character of 13 data characters. */
    private fun luhn32(data: String): Char {
        var factor = 1
        var sum = 0
        for (c in data) {
            var add = factor * ALPHABET.indexOf(c)
            factor = if (factor == 2) 1 else 2
            add = add / 32 + add % 32
            sum += add
        }
        return ALPHABET[(32 - sum % 32) % 32]
    }

    /** Four blocks of 13 characters, each followed by its own check character: a mistyped character fails here. */
    fun hasValidCheckDigits(id: String): Boolean {
        if (!isDeviceId(id)) return false
        val raw = id.replace("-", "")
        for (i in 0 until 4) {
            val block = raw.substring(i * 14, i * 14 + 14)
            if (luhn32(block.substring(0, 13)) != block[13]) return false
        }
        return true
    }

    /** An offer is accepted only for the one folder, from a device the owner paired. */
    fun acceptOffer(folderId: String, deviceId: String, paired: Collection<String>): Boolean =
        folderId == FOLDER_ID && deviceId in paired

    /** The arguments of `syncthing serve` (every flag checked against `serve --help` of v2.1.5). */
    fun launchArgs(home: String, guiPort: Int, apiKey: String): List<String> {
        require(home.isNotBlank()) { "syncthing: empty home" }
        require(guiPort in 1024..65535) { "syncthing: bad GUI port" }
        require(API_KEY.matches(apiKey)) { "syncthing: bad API key" }
        return listOf(
            "serve",
            "--home=$home",
            "--no-browser",
            "--no-restart",
            "--no-upgrade",
            "--gui-address=127.0.0.1:$guiPort",
            "--gui-apikey=$apiKey",
        )
    }

    /** The environment of the child: the parent's minus every `ST*` variable, plus `STNOUPGRADE=1`. */
    fun launchEnv(base: Map<String, String?>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for ((k, v) in base) {
            if (v == null || Regex("^ST[A-Z0-9_]*$").matches(k)) continue
            out[k] = v
        }
        out["STNOUPGRADE"] = "1"
        return out
    }

    /** TCP and QUIC on the pinned port; when it is taken, any port. The relay pool lets two NATed devices meet. */
    fun listenAddresses(portFree: Boolean): List<String> {
        val port = if (portFree) LISTEN_PORT else 0
        return listOf("tcp://:$port", "quic://:$port", DYNAMIC_RELAY)
    }

    /** The options pinned at every start: no browser, no usage or crash report, no self-upgrade, LAN discovery on its own port. */
    fun fixedOptions(portFree: Boolean): JSONObject = JSONObject()
        .put("listenAddresses", JSONArray(listenAddresses(portFree)))
        .put("startBrowser", false)
        .put("urAccepted", -1)
        .put("crashReportingEnabled", false)
        .put("autoUpgradeIntervalH", 0)
        .put("localAnnouncePort", LOCAL_ANNOUNCE_PORT)
        .put("localAnnounceMCAddr", "[ff12::8384]:$LOCAL_ANNOUNCE_PORT")

    /** THE folder, shared with ourselves and with every paired device, once each. */
    fun folderConfig(root: String, ownId: String, paired: Collection<String>): JSONObject {
        val devices = JSONArray()
        for (id in linkedSetOf(ownId) + paired) {
            devices.put(JSONObject().put("deviceID", id).put("introducedBy", "").put("encryptionPassword", ""))
        }
        return JSONObject()
            .put("id", FOLDER_ID)
            .put("label", "Neo Quiz")
            .put("path", root)
            .put("type", "sendreceive")
            .put("devices", devices)
            .put("fsWatcherEnabled", true)
            // Real time (2026-10-03, same values as Windows and as Neo Calendar 1.91.5): an outside change
            // is seen after 1 s instead of 10 s, and the receiving side pulls at once. A change made BY the
            // app is scanned the moment it is written (SyncEngine.signalWrite).
            .put("fsWatcherDelayS", 1)
            // A deletion is held back this long (6 x the delay by default): 6.1 s -> 1.1 s (Neo Calendar, 2026-10-03).
            .put("fsWatcherTimeoutS", 1)
            .put("pullerDelayS", 0)
            // Permission bits mean nothing between Windows and Android.
            .put("ignorePerms", true)
    }

    /**
     * A folder was just created HERE by sync (received from another device). On Android the engine's file watcher
     * does not follow a folder it created itself, so a file put in it later outside the app would only be seen at the
     * hourly scan; restarting the watcher fixes it (Neo Calendar, 2026-10-03). A folder made on the phone is followed.
     */
    fun isNewRemoteDir(ev: JSONObject): Boolean {
        if (ev.optString("type") != "ItemFinished") return false
        val d = ev.optJSONObject("data") ?: return false
        return d.optString("folder") == FOLDER_ID && d.isNull("error") && d.optString("type") == "dir" && d.optString("action") == "update"
    }

    /** The path to scan for a file the app just wrote: relative to [root] with '/', or null when it is not under it. */
    fun pathToScan(root: String, abs: String): String? {
        val r = root.trimEnd('/')
        if (!abs.startsWith("$r/")) return null
        val rel = abs.substring(r.length + 1)
        if (rel.isEmpty() || rel.split('/').any { it.isEmpty() || it == "." || it == ".." }) return null
        return rel
    }

    /** At most this many pending requests are shown. */
    const val MAX_REQUESTS = 8
    private const val NAME_MAX = 64

    /**
     * `GET /rest/cluster/pending/devices` to the devices that added US and that we have not paired
     * (mirror of `demandesDepuis`). Only well-formed ids (format and check characters) that are
     * neither ours nor already paired; the name is the REMOTE's and untrusted: control characters
     * dropped, cut to 64, and the page renders it as text only.
     */
    fun requests(pending: JSONObject?, paired: Collection<String>, ownId: String, max: Int = MAX_REQUESTS): List<Map<String, String>> =
        candidates(pending, paired, ownId).take(max)

    /** How many valid requests the cap of [requests] hides (the page says "+N"). */
    fun requestsMore(pending: JSONObject?, paired: Collection<String>, ownId: String, max: Int = MAX_REQUESTS): Int =
        maxOf(0, candidates(pending, paired, ownId).size - max)

    /** Every valid request, the most recent first (an unreadable time counts as oldest). */
    private fun candidates(pending: JSONObject?, paired: Collection<String>, ownId: String): List<Map<String, String>> {
        if (pending == null) return emptyList()
        val found = ArrayList<Pair<Long, Map<String, String>>>()
        for (id in pending.keys()) {
            if (!isDeviceId(id) || !hasValidCheckDigits(id) || id == ownId || id in paired) continue
            val info = pending.optJSONObject(id)
            val time = try { java.time.OffsetDateTime.parse(info?.optString("time") ?: "").toInstant().toEpochMilli() } catch (_: Exception) { 0L }
            found.add(time to mapOf("id" to id, "nom" to cleanName(info?.optString("name")).ifEmpty { id.take(7) }))
        }
        return found.sortedByDescending { it.first }.map { it.second }
    }

    /**
     * A name announced by ANOTHER device, made safe to show anywhere, a native dialog included
     * (mirror of `nomSur`): control characters (no forged line), the Unicode line and paragraph
     * separators and the bidi overrides/isolates (no reordered text) are dropped, then trimmed and
     * cut to 64. Never trust the raw name.
     */
    fun cleanName(raw: String?): String = (raw ?: "").filter { c ->
        val x = c.code
        !(x <= 0x1f || x in 0x7f..0x9f || x == 0x2028 || x == 0x2029 || x in 0x202a..0x202e || x in 0x2066..0x2069)
    }.trim().take(NAME_MAX)

    /** `lastSeen` of `GET /rest/stats/device` to milliseconds; `null` when never seen (Syncthing writes the zero date) or junk. */
    fun lastSeen(text: String?): Long? {
        if (text == null) return null
        val ms = try { java.time.OffsetDateTime.parse(text).toInstant().toEpochMilli() } catch (_: Exception) { return null }
        return if (ms > 946_684_800_000L) ms else null // 2000-01-01
    }

    /** `GET /rest/db/status` to what the page shows; `null` = the folder is not configured. Scanning counts as idle. */
    fun folderState(s: JSONObject?): FolderState {
        if (s == null) return FolderState("absent", null)
        return when (s.optString("state")) {
            "error" -> FolderState("error", null)
            "syncing", "sync-preparing", "sync-waiting" -> {
                val total = s.optLong("globalBytes", 0)
                if (total <= 0) FolderState("syncing", null)
                else FolderState("syncing", ((s.optLong("inSyncBytes", 0).coerceIn(0, total) * 100) / total).toInt())
            }
            else -> FolderState("idle", null)
        }
    }
}

/**
 * Decides when OTHER devices' changes have landed, so the page reloads the
 * journals and the shared state they live in, and the file scan runs.
 *
 * Syncthing 2.x emits `ItemFinished` ONLY for items the puller applied, i.e.
 * items that came from another device (a local change produces
 * `LocalIndexUpdated` and only that). Then the folder goes back to `idle`
 * (`StateChanged`, `to: "idle"`). An error-free `ItemFinished` of our folder
 * arms the detector; the next `StateChanged` to `idle` of our folder fires it
 * once and disarms. The owner's own edits never fire.
 */
class ReceptionDetector {
    private var armed = false

    fun observe(ev: JSONObject): Boolean {
        val d = ev.optJSONObject("data") ?: return false
        if (d.optString("folder") != ShareRules.FOLDER_ID) return false
        when (ev.optString("type")) {
            "ItemFinished" -> {
                if (!d.has("error") || d.isNull("error") || d.optString("error").isEmpty()) armed = true
                return false
            }
            "StateChanged" -> if (d.optString("to") == "idle" && armed) {
                armed = false
                return true
            }
        }
        return false
    }
}
