package com.ahmedmili.neoquiz.bridge

import android.app.Activity
import android.os.Environment
import com.ahmedmili.neoquiz.code.CodeSandbox
import androidx.activity.ComponentActivity
import com.ahmedmili.neoquiz.sync.SyncChannel
import com.ahmedmili.neoquiz.sync.SyncHub
import com.ahmedmili.neoquiz.ui.FolderPickerDialog
import com.ahmedmili.neoquiz.ui.PairConfirmDialog
import com.ahmedmili.neoquiz.ui.QrScanner
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/** The assembled bridge plus the one thing the host asks of it besides messages: a rescan. */
class AppBridge(
    val bridge: Bridge,
    private val scan: ScanChannel,
    private val scope: CoroutineScope,
    private val code: CodeSandbox,
    private val sync: SyncHub,
    private val qr: QrScanner,
    private val back: BackChannel,
    private val perimeter: Perimeter,
) {
    /** The image behind a `/neo-res/` URL, or `null` when the perimeter or the type allow-list refuses it. */
    fun resource(url: String): ResourceFile? = ResourceRoute.resolve(url, perimeter)

    /** The Back key, asked of the page: false when there is nothing to go back to (the activity leaves). */
    suspend fun goBack(): Boolean = back.request()

    /** Releases what the bridge holds besides coroutines: the hidden code WebView, and the page's hold on the sync. */
    fun shutdown() {
        sync.detach()
        qr.detach()
        code.shutdown()
    }

    /**
     * Re-reads the started roots and pushes what changed (the app came to the
     * foreground). Changes another device synced while the page could not hear
     * are announced after the scan, so the journals are reloaded on top of it.
     */
    fun rescan() {
        scope.launch {
            scan.rescan()
            if (sync.takePendingReception()) bridge.emit("sync.donneesRecues", null)
        }
    }
}

/**
 * Assembles the bridge of the app: the perimeter (fed by the settings kept by a
 * previous session, the default folder and the folder picker), the file, scan,
 * system and settings channels, and the unavailable ones. The app-private
 * `filesDir` is the one place the perimeter never admits.
 */
fun createAppBridge(activity: Activity, scope: CoroutineScope): AppBridge {
    val privateDir = activity.filesDir
    val allowed = AllowedRoots()
    val storage = Environment.getExternalStorageDirectory()
    // Other apps' data and this app's own external dirs are never reachable, even under a root.
    val excluded = listOf(File(storage, "Android/data"), File(storage, "Android/obb")) +
        activity.getExternalFilesDirs(null).filterNotNull() + activity.externalCacheDirs.filterNotNull() + activity.obbDirs.filterNotNull()
    val perimeter = Perimeter(allowed::roots, privateDir) { excluded }
    val documents = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "Neo Quiz")
    val settings = SettingsChannel(
        file = File(privateDir, "settings.json"),
        perimeter = perimeter,
        allowed = allowed,
        defaultDir = { documents },
    )
    // A tiny local file read, once, before the first call can arrive.
    runBlocking { settings.seedRoots() }

    var bridge: Bridge? = null
    val scan = ScanChannel(perimeter) { event -> bridge?.emit("evenement", event) }
    // The synced folder is offered first while it is not a root.
    val suggested = { documents.takeIf { it.isDirectory && !perimeter.contains(it.path) } }
    val codeSandbox = CodeSandbox(activity, scope)
    val system = SystemChannel(perimeter, allowed, settings, FolderPickerDialog(activity, suggested), AndroidFileOpener(activity))

    // The embedded Syncthing (Task 10). The hub outlives this page (the foreground service keeps it);
    // what it holds of the page (dialog, events, perimeter) is released by `AppBridge.shutdown`.
    val hub = SyncHub.get(activity)
    val pairDialog = PairConfirmDialog(activity)
    val qr = QrScanner(activity as ComponentActivity)
    hub.confirmer = { id, name -> pairDialog.ask(id, name) }
    hub.attach(allowed::allow)
    hub.stateListener = { state -> bridge?.emit("sync.etat", state) }
    hub.receivedListener = {
        // Changes of another device landed: scan the folder (file events), then tell the page to reload its journals.
        scope.launch {
            scan.rescan()
            bridge?.emit("sync.donneesRecues", null)
        }
    }
    val syncChannel = SyncChannel(hub, qr::scan)

    val backChannel = BackChannel { bridge?.emit("android.retour", null) }
    val created = Bridge(
        scope,
        Unavailable.handlers() + ClipboardChannel(AndroidClipboard(activity)).handlers() + CodeChannel(codeSandbox).handlers() + FilesChannel(perimeter, allowed).handlers() + scan.handlers() +
            settings.handlers() + system.handlers() + syncChannel.handlers() + backChannel.handlers(),
    )
    bridge = created
    return AppBridge(created, scan, scope, codeSandbox, hub, qr, backChannel, perimeter)
}
