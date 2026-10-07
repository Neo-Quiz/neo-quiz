package com.ahmedmili.neoquiz.update

import java.io.File
import java.io.InputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Where the time of the last successful check lives (SharedPreferences in the app, a variable in tests). */
interface CheckStore {
    fun lastCheck(): Long
    fun setLastCheck(ms: Long)
}

/**
 * What the page shows: the `EtatMiseAJour` of the bridge (`mise-a-jour-etat.ts`),
 * with two phases the phone adds, `disponible` (a version waits for the tap on
 * Install) and `autorisation` (Android must first be told Neo Quiz may install
 * apps). `message` is a CODE (`network`, `invalid`, `mismatch`, `install`) the
 * page translates.
 */
data class UpdateState(
    val phase: String,
    val actuelle: String,
    val version: String? = null,
    val notes: String? = null,
    val pourcent: Int? = null,
    val octetsRecus: Long? = null,
    val octetsTotal: Long? = null,
    val message: String? = null,
) {
    fun toMap(): Map<String, Any?> = buildMap {
        put("phase", phase)
        put("actuelle", actuelle)
        version?.let { put("version", it) }
        notes?.let { put("notes", it) }
        pourcent?.let { put("pourcent", it) }
        octetsRecus?.let { put("octetsRecus", it) }
        octetsTotal?.let { put("octetsTotal", it) }
        message?.let { put("message", it) }
    }
}

/**
 * The updater's state machine: check the manifest, wait for the tap, download,
 * verify, hand the file to the installer. Every effect (network, clock,
 * install permission, installer) is injected, so `UpdateEngineTest` drives the
 * whole thing on the JVM.
 *
 * Nothing is downloaded by [check]: a download starts only from [install], i.e.
 * from the user's tap, so no data (metered or not) is spent without it.
 */
class UpdateEngine(
    private val installedCode: Int,
    private val installedName: String,
    private val dir: File,
    private val openManifest: () -> InputStream,
    private val openApk: (String) -> InputStream,
    private val store: CheckStore,
    private val canInstall: () -> Boolean,
    private val askPermission: () -> Unit,
    /** Hands the verified file to the system installer; answers the id of the install session (see [installFailed]). */
    private val installer: (File, UpdateManifest) -> Int,
    private val abandonSession: (Int) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val onState: (UpdateState) -> Unit = {},
    private val apkDeadlineMs: Long = UpdateDownload.DEADLINE_MS,
) {
    @Volatile var state: UpdateState = UpdateState("inactif", installedName)
        private set
    @Volatile private var manifest: UpdateManifest? = null
    private var working = false

    // Native rate limits (the page is not trusted to throttle itself): after a failure no new
    // download for FAILURE_COOLDOWN_MS, and the unknown-sources screen opens once per ASK_COOLDOWN_MS.
    @Volatile private var lastFailureAt = Long.MIN_VALUE / 2
    @Volatile private var lastAskAt = Long.MIN_VALUE / 2
    @Volatile private var preteAt = 0L
    @Volatile private var session = -1

    private fun set(next: UpdateState) {
        state = next
        onState(next)
    }

    private fun claim(): Boolean = synchronized(this) { if (working) false else { working = true; true } }
    private fun release() = synchronized(this) { working = false }

    /**
     * "prete" means the system installer has the file. If the user dismisses its dialog no
     * callback may ever come, so after PRETE_TIMEOUT_MS the offer comes back (and the file goes).
     */
    fun expirePrete() {
        if (state.phase != "prete" || clock() - preteAt < PRETE_TIMEOUT_MS) return
        val m = manifest
        val id = session
        session = -1
        if (id >= 0) abandonSession(id)
        cleanup()
        if (m != null) set(UpdateState("disponible", installedName, version = m.versionName, notes = m.notes))
        else set(UpdateState("inactif", installedName))
    }

    /** Removes what an earlier run left in the cache (a partial or already installed APK). */
    fun cleanup() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** Checks the manifest; [force] ignores the 6 h interval (the manual button). Returns whether a check ran. */
    suspend fun check(force: Boolean): Boolean = withContext(Dispatchers.IO) {
        expirePrete()
        if (state.phase == "telechargement" || state.phase == "prete") return@withContext false
        if (!force && !UpdateRules.due(store.lastCheck(), clock())) return@withContext false
        if (!claim()) return@withContext false
        val before = state
        try {
            set(UpdateState("verification", installedName))
            val found = try {
                UpdateRules.parse(UpdateDownload.readManifest(openManifest))
            } catch (e: CancellationException) {
                throw e
            } catch (e: UpdateRefused) {
                return@withContext failedCheck(force, before, "invalid")
            } catch (e: Exception) {
                return@withContext failedCheck(force, before, "network")
            }
            store.setLastCheck(clock())
            if (UpdateRules.isNewer(installedCode, found)) {
                manifest = found
                set(UpdateState("disponible", installedName, version = found.versionName, notes = found.notes))
            } else {
                manifest = null
                set(UpdateState("a-jour", installedName))
            }
            true
        } finally {
            release()
        }
    }

    /** A failed AUTOMATIC check is silent (the previous state comes back); a manual one says so. */
    private fun failedCheck(force: Boolean, before: UpdateState, code: String): Boolean {
        set(if (force) UpdateState("erreur", installedName, message = code) else before)
        return true
    }

    /** The tap on Install: permission, download, verification, then the installer. */
    suspend fun install() = withContext(Dispatchers.IO) {
        expirePrete()
        val m = manifest ?: return@withContext
        if (state.phase != "disponible" && state.phase != "autorisation" && state.phase != "erreur") return@withContext
        if (clock() - lastFailureAt < FAILURE_COOLDOWN_MS) return@withContext
        if (!canInstall()) {
            set(UpdateState("autorisation", installedName, version = m.versionName, notes = m.notes))
            if (clock() - lastAskAt >= ASK_COOLDOWN_MS) {
                lastAskAt = clock()
                askPermission()
            }
            return@withContext
        }
        if (!claim()) return@withContext
        try {
            var last = -1
            set(UpdateState("telechargement", installedName, version = m.versionName, pourcent = 0, octetsRecus = 0, octetsTotal = m.size))
            val apk = try {
                UpdateDownload.fetchApk(m, dir, openApk, { got, total ->
                    val pct = (got * 100 / total).toInt()
                    if (pct != last) {
                        last = pct
                        set(UpdateState("telechargement", installedName, version = m.versionName, pourcent = pct, octetsRecus = got, octetsTotal = total))
                    }
                }, apkDeadlineMs)
            } catch (e: CancellationException) {
                throw e
            } catch (e: UpdateRefused) {
                return@withContext downloadFailed(m, "mismatch")
            } catch (e: Exception) {
                return@withContext downloadFailed(m, "network")
            } catch (e: OutOfMemoryError) {
                return@withContext downloadFailed(m, "network")
            }
            preteAt = clock()
            set(UpdateState("prete", installedName, version = m.versionName))
            try {
                session = installer(apk, m)
            } catch (e: Exception) {
                session = -1
                fail()
            }
        } finally {
            release()
        }
    }

    private fun downloadFailed(m: UpdateManifest, code: String) {
        lastFailureAt = clock()
        set(UpdateState("erreur", installedName, version = m.versionName, message = code))
    }

    private fun fail() {
        lastFailureAt = clock()
        cleanup()
        val m = manifest
        set(UpdateState("erreur", installedName, version = m?.versionName, notes = m?.notes, message = "install"))
    }

    /**
     * The system installer refused or was cancelled. Only believed while the phase is "prete"
     * AND the broadcast is about THIS session: a stale answer must never delete the file of a
     * newer download. The file goes, the user may tap again (after the cooldown).
     */
    fun installFailed(sessionId: Int) {
        if (state.phase != "prete" || sessionId != session) return
        session = -1
        fail()
    }

    companion object {
        const val FAILURE_COOLDOWN_MS = 30_000L
        const val ASK_COOLDOWN_MS = 5 * 60_000L
        const val PRETE_TIMEOUT_MS = 10 * 60_000L
    }
}
