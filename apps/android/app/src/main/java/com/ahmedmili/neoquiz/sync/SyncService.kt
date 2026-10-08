package com.ahmedmili.neoquiz.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.graphics.drawable.Icon
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.ahmedmili.neoquiz.MainActivity
import com.ahmedmili.neoquiz.R
import com.ahmedmili.neoquiz.bridge.resolveReal
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray

/** What the `sync.*` bridge channels need; implemented by [SyncHub], faked in the bridge test. */
interface SyncBackend {
    suspend fun state(): Map<String, Any?>
    /** `name`: announced by a scanned pairing QR code, shown in the confirmation; null when typed. */
    suspend fun pair(id: String, name: String?): String
    /** Pairs an id the camera just read (never one from the page). */
    suspend fun pairScanned(id: String, name: String): String
    suspend fun forget(id: String)
    /** The name this device shows for a paired one (cleaned, at most 64). */
    suspend fun rename(id: String, name: String)
    /** Sends again a request that expired (the device was paused). */
    suspend fun sendAgain(id: String)
    /** The last lines of Syncthing's log, newest first (`lignes` of `LigneJournal`,
        at most 200); null when sync is not running (switched off, unavailable). */
    suspend fun logLines(): JSONArray?
    /** The owner switched sync OFF: remember it ([KEY_ACTIVE] at `false`) and stop
        the engine. Nothing starts it again until [activate], not even the page
        asking for the state ([ensure] refuses). */
    suspend fun deactivate()
    /** The owner switched sync back ON: the flag goes up, the engine starts. */
    suspend fun activate()
    suspend fun ignore(id: String)
}

/**
 * The process-wide owner of the embedded Syncthing. The foreground service
 * ([SyncService]) keeps the process alive, the bridge talks to the engine
 * through [SyncBackend]. The engine is created once, lazily, by whichever
 * comes first: the Sync page asking for its state, or the service.
 *
 * The shared folder is ALWAYS `/storage/emulated/0/Neo Quiz` ([ShareRules.sharedRoot]);
 * once sync starts, that directory is admitted to the bridge's perimeter
 * ([allowRoot]) so it can be an app root.
 */
class SyncHub private constructor(private val appContext: Context) : SyncBackend {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    @Volatile private var engine: SyncEngine? = null
    private val prefs get() = appContext.getSharedPreferences("sync", Context.MODE_PRIVATE)

    @Volatile private var allowRoot: ((File) -> Unit)? = null
    @Volatile var stateListener: ((Map<String, Any?>) -> Unit)? = null
    @Volatile var receivedListener: (() -> Unit)? = null
    /** The latest state the engine pushed, and a listener for the foreground notification (owned by [SyncService], independent of any page). */
    @Volatile var lastState: Map<String, Any?>? = null
    @Volatile var notifyListener: ((Map<String, Any?>) -> Unit)? = null
    /** True while an activity is on screen; a reception while away is remembered, see [takePendingReception]. */
    @Volatile var foreground = false
    @Volatile private var pendingReception = false

    /**
     * Android refused or ended the foreground service (the 6 h/day dataSync budget of Android 15,
     * or a start from the background). Relaunching on every page request would loop (start,
     * refused, stop, kill); sync stays paused, and the state says so, until the app is opened again.
     */
    @Volatile private var paused = false

    fun markPaused() { paused = true }

    /** The app wrote [abs]: scanned at once when sync runs (never starts it). */
    fun signalWrite(abs: String) { engine?.signalWrite(abs) }

    /** The app came to the screen: a new foreground start is allowed again. */
    fun resume() { paused = false }

    /** The bridge attaches: it admits the shared folder to its perimeter (now if the engine already runs, e.g. after a service-only start). */
    fun attach(allow: (File) -> Unit) {
        allowRoot = allow
        if (engine != null) admitRoot()
    }

    /**
     * Resolves `/storage/emulated/0/Neo Quiz` on the disk and admits it to the perimeter. `null` (sync
     * must not start) when it cannot be resolved, resolves anywhere else (a symlink), or the old
     * `Documents/Neo Quiz` still holds files ([FolderMove]: moved first, never merged).
     */
    private fun admitRoot(): File? {
        val storage = Environment.getExternalStorageDirectory()
        val shared = ShareRules.sharedRoot(storage)
        val legacy = FolderMove.legacyRoot(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS))
        FolderMove.move(legacy, shared)
        if (FolderMove.blocked(legacy)) return null
        shared.mkdirs()
        val real = resolveReal(shared) ?: return null
        val realStorage = resolveReal(storage) ?: return null
        if (!ShareRules.isCanonicalSharedRoot(real, realStorage)) return null
        allowRoot?.invoke(real)
        return real
    }

    fun detach() {
        allowRoot = null
        stateListener = null
        receivedListener = null
    }

    /**
     * The owner's choice, THREE states (mirror of the Windows `syncActif`):
     * `null` (the key is absent: never paired, the engine starts on demand the
     * first time the page asks), `true` (switched on: started at boot too),
     * `false` (switched off in the Sync page: [ensure] never starts it).
     */
    private fun activeFlag(): Boolean? = if (prefs.contains(KEY_ACTIVE)) prefs.getBoolean(KEY_ACTIVE, false) else null

    /** True once sync was switched on (a first pairing, or [activate]): the
        service restarts at boot in that case only. */
    fun isActive(): Boolean = prefs.getBoolean(KEY_ACTIVE, false)

    fun received() {
        val l = receivedListener
        if (foreground && l != null) l() else pendingReception = true
    }

    /** True once if changes arrived while no page could hear it. */
    fun takePendingReception(): Boolean = pendingReception.also { pendingReception = false }

    /** Starts the foreground service (idempotent). Only from the foreground: Android refuses it from the background. */
    fun startService() {
        try {
            ContextCompat.startForegroundService(appContext, Intent(appContext, SyncService::class.java))
        } catch (e: Exception) {
            SyncLog.warn(TAG, "cannot start the sync service", e)
        }
    }

    /** Creates and starts the engine once; `null` when Syncthing cannot run (the next call retries). */
    suspend fun launchEngine(): SyncEngine? = lock.withLock {
        engine?.let { return it }
        val root = admitRoot()
        if (root == null) {
            Log.w(TAG, "Neo Quiz cannot be resolved to itself, or its old folder was not moved: sync not started")
            return null
        }
        // An import interrupted long ago left its (Syncthing-ignored) staging folder: nobody else removes it.
        scope.launch { StagingCleanup.purge(root, System.currentTimeMillis()) }
        val home = File(appContext.filesDir, "syncthing")
        val process = SyncthingProcess(File(appContext.applicationInfo.nativeLibraryDir, ProcTable.BINARY_NAME), home, File(appContext.cacheDir, "syncthing-tmp"))
        val created = SyncEngine(
            launcher = { process.start() },
            root = root,
            deviceName = ownName(),
            portFree = process::listenPortFree,
            scope = scope,
        )
        created.onState = { s -> lastState = s; stateListener?.invoke(s); notifyListener?.invoke(s) }
        created.onReceived = {
            received()
            scope.launch(Dispatchers.IO) { com.ahmedmili.neoquiz.notify.ChatNotifier.scan(appContext, root) }
        }
        created.onPaired = { prefs.edit().putBoolean(KEY_ACTIVE, true).apply() }
        try {
            created.start()
            engine = created
            created
        } catch (e: Exception) {
            SyncLog.warn(TAG, "syncthing unavailable", e)
            null
        }
    }

    /** The name the owner gave this phone (Settings, About), else its model: shown on the page and on the other devices. */
    private fun ownName(): String =
        (android.provider.Settings.Global.getString(appContext.contentResolver, "device_name")?.trim()?.takeIf { it.isNotEmpty() } ?: Build.MODEL).take(64)

    /** Called by the service when it goes away. */
    suspend fun shutdown() = lock.withLock {
        val e = engine
        engine = null
        lastState = null
        e?.stop()
    }

    private suspend fun ensure(): SyncEngine? {
        if (paused) return null
        // Switched off in the Sync page: NOTHING starts the engine, not even the page asking for the state.
        if (activeFlag() == false) return null
        engine?.let { admitRoot(); return it }
        startService()
        // First start can take a while (key generation); the page waits for its id. Only the WAIT times out:
        // cancelling the launch itself would leave a half-started process without an owner.
        val launch = scope.async { launchEngine() }
        return withTimeoutOrNull(45_000) { launch.await() }
    }

    override suspend fun state(): Map<String, Any?> = ensure()?.state() ?: SyncEngine.ABSENT

    // One pairing at a time: a second one while another runs is dropped.
    private val pairing = SingleFlight()

    override suspend fun pair(id: String, name: String?): String = pairing.run(PairResult.CANCELLED) { ensure()?.pair(id, name) ?: PairResult.UNAVAILABLE }

    override suspend fun pairScanned(id: String, name: String): String =
        pairing.run(PairResult.CANCELLED) { ensure()?.pair(id, name) ?: PairResult.UNAVAILABLE }

    override suspend fun forget(id: String) { ensure()?.forget(id) }

    override suspend fun rename(id: String, name: String) { ensure()?.rename(id, name) }

    override suspend fun sendAgain(id: String) { ensure()?.sendAgain(id) }

    override suspend fun logLines(): JSONArray? {
        val e = ensure() ?: return null
        return try { e.logLines() } catch (_: Exception) { null }
    }

    override suspend fun deactivate() {
        prefs.edit().putBoolean(KEY_ACTIVE, false).apply()
        // The service only exists to keep the engine alive: it goes with it.
        appContext.stopService(Intent(appContext, SyncService::class.java))
        shutdown()
    }

    override suspend fun activate() {
        prefs.edit().putBoolean(KEY_ACTIVE, true).apply()
        // A refusal earlier in the app's life must not swallow the owner's press.
        paused = false
        startService()
    }

    override suspend fun ignore(id: String) { ensure()?.ignore(id) }

    companion object {
        private const val TAG = "NeoSync"
        private const val KEY_ACTIVE = "active"

        @Volatile private var instance: SyncHub? = null

        fun get(context: Context): SyncHub = instance ?: synchronized(this) {
            instance ?: SyncHub(context.applicationContext).also {
                SyncLog.verbose = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
                instance = it
            }
        }

        fun peek(): SyncHub? = instance
    }
}

/**
 * Foreground service (type `specialUse` since 2026-10-03, `dataSync` before)
 * that keeps the embedded Syncthing alive while the app is in the background,
 * so the phone and the tablet stay in step with the PCs. It starts again at
 * boot and after an update (`SyncBootReceiver`), which Android 15+ refuses for
 * a `dataSync` service; [onTimeout] only concerned the 6 h/day budget of that
 * former type and is kept as a clean stop.
 */
class SyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    private val handler = Handler(Looper.getMainLooper())
    private var latest: Map<String, Any?>? = null
    private var lastPost = 0L
    private var lastText: String? = null
    private var scheduled = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val hub = SyncHub.get(this)
        // "Quit" on the notification: the same path as the Sync page's off switch (the flag goes down, the
        // engine stops, the service goes with it).
        if (intent?.action == ACTION_QUIT) {
            scope.launch { hub.deactivate() }
            return START_NOT_STICKY
        }
        try {
            // "specialUse", not "dataSync" (2026-10-03, same as Neo Calendar): Android 15+ refuses to start a dataSync
            // service at boot, and caps it at 6 h a day; sync must restart with the phone and run as long as needed.
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } catch (e: Exception) {
            // The system refused a foreground start (app in the background): nothing to keep alive.
            SyncLog.warn(TAG, "foreground start refused", e)
            hub.markPaused()
            stopSelf()
            return START_NOT_STICKY
        }
        // A restart by the system carries no intent: only resume when sync was switched on.
        if (intent == null && !hub.isActive()) {
            stopSelf()
            return START_NOT_STICKY
        }
        hub.notifyListener = { s -> handler.post { latest = s; postSoon() } }
        latest = hub.lastState
        scope.launch { if (hub.launchEngine() == null) stopSelf() }
        return START_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "dataSync time budget exhausted: stopping")
        SyncHub.get(this).markPaused()
        stopSelf()
    }

    /** The notification follows the state, at most once a second (a progress burst must not flood the system). */
    private fun postSoon() {
        val wait = lastPost + MIN_GAP_MS - SystemClock.elapsedRealtime()
        if (wait <= 0) post() else if (!scheduled) {
            scheduled = true
            handler.postDelayed({ scheduled = false; post() }, wait)
        }
    }

    private fun post() {
        val n = notification()
        // Same text as already shown: nothing to send.
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        if (text == lastText) return
        lastText = text
        lastPost = SystemClock.elapsedRealtime()
        try { getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, n) } catch (e: Exception) { SyncLog.warn(TAG, "cannot update the notification", e) }
    }

    private fun statusText(): String {
        val s = SyncSummary.of(latest)
        val devices = resources.getQuantityString(R.plurals.sync_connected_devices, s.connected, s.connected)
        return when (s.kind) {
            SyncSummary.Kind.STARTING -> getString(R.string.sync_notification_title)
            SyncSummary.Kind.PAUSED -> getString(R.string.sync_status_paused)
            SyncSummary.Kind.SCANNING -> getString(R.string.sync_status_scanning)
            SyncSummary.Kind.ERROR -> getString(R.string.sync_status_error)
            SyncSummary.Kind.NO_DEVICE -> getString(R.string.sync_status_none)
            SyncSummary.Kind.SYNCING -> if (s.percent != null) getString(R.string.sync_status_syncing, s.percent, devices) else getString(R.string.sync_status_syncing_unknown, devices)
            SyncSummary.Kind.UP_TO_DATE -> getString(R.string.sync_status_synced, devices)
        }
    }

    override fun onDestroy() {
        SyncHub.peek()?.notifyListener = null
        handler.removeCallbacksAndMessages(null)
        // The process may be killed right after: stop Syncthing on its own thread, with a bounded wait.
        val hub = SyncHub.peek()
        if (hub != null) Thread { kotlinx.coroutines.runBlocking { hub.shutdown() } }.apply { isDaemon = false; start() }
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, getString(R.string.sync_channel_name), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val quit = PendingIntent.getService(this, 1, Intent(this, SyncService::class.java).setAction(ACTION_QUIT), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.sync_notification_name))
            .setContentText(statusText())
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), getString(R.string.sync_quit), quit).build())
            .build()
    }

    private companion object {
        const val TAG = "NeoSync"
        const val CHANNEL_ID = "sync"
        const val NOTIFICATION_ID = 1
        const val MIN_GAP_MS = 1000L
        const val ACTION_QUIT = "com.ahmedmili.neoquiz.sync.QUIT"
    }
}
