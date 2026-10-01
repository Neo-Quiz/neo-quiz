package com.ahmedmili.neoquiz.sync

import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject

/** The answers of `sync.appairer`, as the page reads them (`pont.ts`). */
object PairResult {
    const val OK = "ok"
    const val INVALID = "invalide"
    const val UNAVAILABLE = "indisponible"
    const val CANCELLED = "annule"
}

/**
 * The configure / poll / accept loop of the embedded Syncthing, mirror of
 * `startSync` in `apps/windows/electron/syncthing.ts` (Task 6):
 *
 * - at start: pinned options, the device name, THE folder (`neo-quiz`, at
 *   [root]) shared with the paired devices, and its `.stignore`;
 * - every [intervalMs]: the events (reception detector, names of devices that
 *   connected), the pending offers (accepted only for our folder, from a paired
 *   device: re-aligning the folder with the paired list is the whole
 *   acceptance), and the state pushed when it changed;
 * - one restart on an unexpected exit, then the page shows sync as off.
 *
 * `confirm` is the NATIVE pairing confirmation (a dialog the page cannot
 * answer); nothing is paired without it.
 */
class SyncEngine(
    private val launcher: () -> SyncthingInstance,
    private val root: File,
    private val deviceName: String,
    private val portFree: () -> Boolean,
    private val confirm: suspend (deviceId: String, name: String) -> Boolean,
    private val scope: CoroutineScope,
    private val intervalMs: Long = 10_000,
) {
    private class Running(val instance: SyncthingInstance, val ownId: String)

    @Volatile var onState: ((Map<String, Any?>) -> Unit)? = null
    @Volatile var onReceived: (() -> Unit)? = null
    /** Fired once after the first successful pairing: sync stays on from then. */
    @Volatile var onPaired: (() -> Unit)? = null

    @Volatile private var current: Running? = null
    @Volatile private var stopped = false
    @Volatile private var dead = false
    private var restarted = false
    private var since = 0L
    private var detector = ReceptionDetector()
    private var last = ""
    private val tickLock = Mutex()
    private var loop: Job? = null

    suspend fun start() {
        withContext(Dispatchers.IO) { current = launchAndConfigure() }
        watch(current!!)
        loop = scope.launch(Dispatchers.IO) {
            while (isActive && !stopped) {
                delay(intervalMs)
                tick()
            }
        }
    }

    private fun launchAndConfigure(): Running {
        val instance = launcher()
        try {
            val rest = instance.rest
            val ownId = rest.myId()
            rest.patchOptions(ShareRules.fixedOptions(portFree()))
            val devices = rest.devices()
            var me: JSONObject? = null
            val paired = ArrayList<String>()
            for (i in 0 until devices.length()) {
                val d = devices.getJSONObject(i)
                if (d.getString("deviceID") == ownId) me = d else paired.add(d.getString("deviceID"))
            }
            if (me != null && me.optString("name") != deviceName) rest.putDevice(me.put("name", deviceName))
            root.mkdirs()
            rest.putFolder(ShareRules.folderConfig(root.path, ownId, paired))
            rest.setIgnores(ShareRules.FOLDER_ID, ShareRules.IGNORES)
            return Running(instance, ownId)
        } catch (e: Exception) {
            instance.stop(graceMs = 2000)
            throw e
        }
    }

    /** One restart on an unexpected exit; the wrapper may have died while its child still holds the home (`releaseHome` clears it). */
    private fun watch(r: Running) {
        Thread {
            r.instance.waitFor()
            if (stopped || current !== r) return@Thread
            scope.launch(Dispatchers.IO) {
                if (restarted) { dead = true; push(); return@launch }
                restarted = true
                try {
                    val next = launchAndConfigure()
                    since = 0
                    detector = ReceptionDetector()
                    current = next
                    watch(next)
                } catch (e: Exception) {
                    SyncLog.warn(TAG, "restart failed", e)
                    dead = true
                }
                last = ""
                push()
            }
        }.apply { isDaemon = true; start() }
    }

    private fun pairedIds(r: Running): List<String> {
        val devices = r.instance.rest.devices()
        return (0 until devices.length()).map { devices.getJSONObject(it).getString("deviceID") }.filter { it != r.ownId }
    }

    private fun align(r: Running, paired: Collection<String>) {
        r.instance.rest.putFolder(ShareRules.folderConfig(root.path, r.ownId, paired))
    }

    suspend fun state(): Map<String, Any?> = withContext(Dispatchers.IO) { computeState() }

    private fun computeState(): Map<String, Any?> {
        val r = current
        if (dead || r == null) return ABSENT
        val rest = r.instance.rest
        val devices = rest.devices()
        val connections = rest.connections().optJSONObject("connections") ?: JSONObject()
        val status = try { rest.folderStatus(ShareRules.FOLDER_ID) } catch (_: Exception) { null }
        val folder = ShareRules.folderState(status)
        return mapOf(
            "actif" to true,
            "appareil" to r.ownId,
            "appareils" to (0 until devices.length()).map { devices.getJSONObject(it) }.filter { it.getString("deviceID") != r.ownId }.map { d ->
                val id = d.getString("deviceID")
                mapOf("id" to id, "nom" to d.optString("name").ifEmpty { id.take(7) }, "connecte" to (connections.optJSONObject(id)?.optBoolean("connected") == true))
            },
            "dossier" to mapOf("etat" to folder.state, "pourcentage" to folder.percent),
        )
    }

    private fun push() {
        val s = try { computeState() } catch (_: Exception) { return }
        val text = JSONObject(s).toString()
        if (text == last) return
        last = text
        onState?.invoke(s)
    }

    private suspend fun tick() {
        if (stopped || dead || !tickLock.tryLock()) return
        try {
            val r = current ?: return
            val rest = r.instance.rest
            var received = false
            val events = rest.events(since, EVENTS)
            for (i in 0 until events.length()) {
                val ev = events.getJSONObject(i)
                if (ev.optLong("id") > since) since = ev.optLong("id")
                if (detector.observe(ev)) received = true
                // The name Syncthing reports for a device that connected, kept when we have none yet (a device paired by id has no name).
                val data = ev.optJSONObject("data")
                if (ev.optString("type") == "DeviceConnected" && data != null && data.optString("deviceName").isNotBlank()) {
                    val devices = rest.devices()
                    for (j in 0 until devices.length()) {
                        val cfg = devices.getJSONObject(j)
                        if (cfg.getString("deviceID") == data.optString("id") && cfg.optString("name").isEmpty()) {
                            rest.putDevice(cfg.put("name", data.getString("deviceName").trim().take(64)))
                        }
                    }
                }
            }
            val paired = pairedIds(r)
            val offers = rest.pendingFolders()
            var realign = false
            for (folderId in offers.keys()) {
                val by = offers.optJSONObject(folderId)?.optJSONObject("offeredBy") ?: continue
                for (deviceId in by.keys()) if (ShareRules.acceptOffer(folderId, deviceId, paired)) realign = true
            }
            if (realign) align(r, paired)
            push()
            if (received) onReceived?.invoke()
        } catch (e: Exception) {
            if (!stopped) SyncLog.warn(TAG, "poll failed", e)
        } finally {
            tickLock.unlock()
        }
    }

    suspend fun pair(raw: String): String = withContext(Dispatchers.IO) {
        val id = raw.trim()
        val r = current
        if (!ShareRules.isDeviceId(id) || !ShareRules.hasValidCheckDigits(id) || r == null || id == r.ownId || dead) return@withContext PairResult.INVALID
        try {
            val paired = pairedIds(r)
            if (id in paired) return@withContext PairResult.OK
            if (paired.size >= MAX_DEVICES) return@withContext PairResult.INVALID
            val waiting = r.instance.rest.pendingDevices().optJSONObject(id)
            val name = waiting?.optString("name")?.trim()?.take(64) ?: ""
            // Nothing is paired without the owner's say: a native dialog the page cannot answer.
            val agreed = try { confirm(id, name) } catch (_: Exception) { false }
            if (!agreed) return@withContext PairResult.CANCELLED
            r.instance.rest.putDevice(
                JSONObject().put("deviceID", id).put("name", name).put("addresses", org.json.JSONArray(listOf("dynamic")))
                    .put("introducer", false).put("autoAcceptFolders", false).put("paused", false),
            )
            align(r, paired + id)
            onPaired?.invoke()
            push()
            PairResult.OK
        } catch (e: Exception) {
            SyncLog.warn(TAG, "pairing failed", e)
            PairResult.UNAVAILABLE
        }
    }

    suspend fun forget(raw: String) = withContext(Dispatchers.IO) {
        val id = raw.trim()
        val r = current
        if (!ShareRules.isDeviceId(id) || r == null || id == r.ownId || dead) return@withContext
        val paired = pairedIds(r)
        if (id !in paired) return@withContext
        // The folder first: a device still referenced by a folder cannot go.
        align(r, paired.filter { it != id })
        r.instance.rest.deleteDevice(id)
        push()
    }

    suspend fun stop() {
        if (stopped) return
        stopped = true
        loop?.cancel()
        val r = current
        withContext(Dispatchers.IO) { r?.instance?.stop() }
    }

    companion object {
        private const val TAG = "NeoSync"
        private const val MAX_DEVICES = 16
        private val EVENTS = listOf("StateChanged", "ItemFinished", "DeviceConnected")
        val ABSENT: Map<String, Any?> = mapOf(
            "actif" to false, "appareil" to null, "appareils" to emptyList<Any>(),
            "dossier" to mapOf("etat" to "absent", "pourcentage" to null),
        )
    }
}
