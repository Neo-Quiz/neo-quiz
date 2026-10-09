package com.ahmedmili.neoquiz.bridge

import android.app.Activity
import android.content.Intent
import com.ahmedmili.neoquiz.R
import android.os.Environment
import com.ahmedmili.neoquiz.code.CodeSandbox
import androidx.activity.ComponentActivity
import com.ahmedmili.neoquiz.notify.CalendarChannel
import com.ahmedmili.neoquiz.notify.ChatNotifier
import com.ahmedmili.neoquiz.notify.ChatNotifyChannel
import com.ahmedmili.neoquiz.notify.DueCalendar
import com.ahmedmili.neoquiz.notify.ReviewAlarm
import com.ahmedmili.neoquiz.sync.FolderMove
import com.ahmedmili.neoquiz.sync.ShareRules
import com.ahmedmili.neoquiz.sync.SyncChannel
import com.ahmedmili.neoquiz.sync.PairLinkRequest
import com.ahmedmili.neoquiz.sync.SyncHub
import com.ahmedmili.neoquiz.ui.FolderPickerDialog
import com.ahmedmili.neoquiz.ui.NavBarView
import com.ahmedmili.neoquiz.ui.QrScanner
import com.ahmedmili.neoquiz.update.UpdateChannel
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

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
    /** The native bottom tab bar (`NavBarView`); the activity places it under the WebView. */
    val navBar: NavBarView,
    private val update: UpdateChannel,
) {
    /** The image behind a `/neo-res/` URL, or `null` when the perimeter or the type allow-list refuses it. */
    fun resource(url: String): ResourceFile? = ResourceRoute.resolve(url, perimeter)

    /** The Back key, asked of the page: false when there is nothing to go back to (the activity leaves). */
    suspend fun goBack(): Boolean = back.request()

    /** Releases what the bridge holds besides coroutines: the hidden code WebView, and the page's hold on the sync. */
    fun shutdown() {
        sync.detach()
        PairLinkRequest.listener = null
        IncomingInbox.shared.listener = null
        qr.detach()
        code.shutdown()
    }

    /**
     * Re-reads the started roots and pushes what changed (the app came to the
     * foreground). Changes another device synced while the page could not hear
     * are announced after the scan, so the journals are reloaded on top of it.
     */
    fun rescan() {
        // Start and every return to the foreground: the updater checks for a new version (at most every 6 h).
        update.onForeground()
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
    // The synced folder, at the root of the shared storage (2026-10-04). The old Documents/Neo Quiz
    // is moved there first, and the paths kept in the settings follow it once it is gone.
    val documents = ShareRules.sharedRoot(storage)
    val legacy = FolderMove.legacyRoot(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS))
    FolderMove.move(legacy, documents)
    val settings = SettingsChannel(
        file = File(privateDir, "settings.json"),
        perimeter = perimeter,
        allowed = allowed,
        defaultDir = { documents },
    )
    // A tiny local file read, once, before the first call can arrive.
    runBlocking {
        if (!legacy.exists()) settings.movePaths(legacy.path, documents.path)
        settings.seedRoots()
    }

    var bridge: Bridge? = null
    val scan = ScanChannel(perimeter) { event -> bridge?.emit("evenement", event) }
    // The page's own writes, moves and removals reach it as file events (see `OwnWriteRescan`).
    val ownWrites = OwnWriteRescan(scope, scan::rescan)
    // The synced folder is offered first while it is not a root.
    val suggested = { documents.takeIf { it.isDirectory && !perimeter.contains(it.path) } }
    val codeSandbox = CodeSandbox(activity, scope)
    val system = SystemChannel(perimeter, allowed, settings, FolderPickerDialog(activity, suggested), AndroidFileOpener(activity))

    // The embedded Syncthing (Task 10). The hub outlives this page (the foreground service keeps it);
    // what it holds of the page (dialog, events, perimeter) is released by `AppBridge.shutdown`.
    val hub = SyncHub.get(activity)
    val qr = QrScanner(activity as ComponentActivity)
    // A pairing link opened the app (or arrived while it runs): the page reads it, and only fills in "Add a device".
    PairLinkRequest.listener = { bridge?.emit("sync.lienAppairage", null) }
    // A file another app opened or shared with us: the page reads it once (`android.fichierRecu`).
    IncomingInbox.shared.listener = { bridge?.emit("android.fichierRecu", null) }
    hub.attach(allowed::allow)
    hub.stateListener = { state -> bridge?.emit("sync.etat", state) }
    hub.receivedListener = {
        // Changes of another device landed: scan the folder (file events), then tell the page to reload its journals.
        scope.launch {
            scan.rescan()
            bridge?.emit("sync.donneesRecues", null)
        }
    }
    // The share sheet carries a text built HERE from this device's id and the app's own strings: the page names a channel, nothing else.
    val syncChannel = SyncChannel(hub, qr::scan) { id ->
        try {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, activity.getString(R.string.sync_share_subject))
                .putExtra(Intent.EXTRA_TEXT, activity.getString(R.string.sync_share_body, id))
            withContext(Dispatchers.Main) { activity.startActivity(Intent.createChooser(send, null)) }
            true
        } catch (_: Exception) {
            false
        }
    }

    val backChannel = BackChannel { bridge?.emit("android.retour", null) }
    val navBar = NavBarView(activity).apply { onTap = { i -> bridge?.emit("android.barreClic", i) } }
    val updateChannel = UpdateChannel.create(activity, scope) { state -> bridge?.emit("miseAJour.etat", state) }
    val calendarChannel = CalendarChannel(DueCalendar.of(activity)) { ReviewAlarm.scheduleNext(activity) }
    val chatNotifyChannel = ChatNotifyChannel(ChatNotifier.store(activity))
    val created = Bridge(
        scope,
        Unavailable.handlers() + ShareChannel(File(activity.cacheDir, "share"), AndroidShareSender(activity)).handlers() + RelayChannel(File(activity.cacheDir, "share"), AndroidPromptSender(activity), AndroidClipboard(activity), AndroidClipboardSource(activity)).handlers() + IncomingChannel().handlers() + HtmlFrameChannel().handlers() + ClipboardChannel(AndroidClipboard(activity)).handlers() + CodeChannel(codeSandbox) { event, data -> bridge?.emit(event, data) }.handlers() + FilesChannel(perimeter, allowed) { ownWrites.onWrite(it); hub.signalWrite(it) }.handlers() + scan.handlers() +
            settings.handlers() + system.handlers() + syncChannel.handlers() + backChannel.handlers() + calendarChannel.handlers() + chatNotifyChannel.handlers() + updateChannel.handlers() + NavBarChannel(navBar::apply, { navBar.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK) }).handlers() + HourFormatChannel { android.text.format.DateFormat.is24HourFormat(activity) }.handlers(),
    )
    bridge = created
    return AppBridge(created, scan, scope, codeSandbox, hub, qr, backChannel, perimeter, navBar, updateChannel)
}
