package com.ahmedmili.neoquiz.bridge

import android.app.Activity
import android.os.Environment
import com.ahmedmili.neoquiz.ui.FolderPickerDialog
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/** The assembled bridge plus the one thing the host asks of it besides messages: a rescan. */
class AppBridge(val bridge: Bridge, private val scan: ScanChannel, private val scope: CoroutineScope) {
    /** Re-reads the started roots and pushes what changed (the app came to the foreground). */
    fun rescan() {
        scope.launch { scan.rescan() }
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
    val system = SystemChannel(perimeter, allowed, settings, FolderPickerDialog(activity, suggested), AndroidFileOpener(activity))
    val created = Bridge(
        scope,
        Unavailable.handlers() + FilesChannel(perimeter, allowed).handlers() + scan.handlers() + settings.handlers() + system.handlers(),
    )
    bridge = created
    return AppBridge(created, scan, scope)
}
