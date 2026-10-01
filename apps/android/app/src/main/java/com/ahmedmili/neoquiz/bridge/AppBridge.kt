package com.ahmedmili.neoquiz.bridge

import android.content.Context
import android.os.Environment
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.runBlocking

/**
 * Assembles the bridge of the app: the perimeter (fed by the settings kept by a
 * previous session, the default folder and, from Task 8, the folder picker),
 * the file and settings channels, and the unavailable ones. The app-private
 * `filesDir` is the one place the perimeter never admits.
 */
fun createAppBridge(context: Context, scope: CoroutineScope): Bridge {
    val privateDir = context.filesDir
    val allowed = AllowedRoots()
    val perimeter = Perimeter(allowed::roots, privateDir)
    val settings = SettingsChannel(
        file = File(privateDir, "settings.json"),
        perimeter = perimeter,
        allowed = allowed,
        defaultDir = { File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "Neo Quiz") },
    )
    // A tiny local file read, once, before the first call can arrive.
    runBlocking { settings.seedRoots() }
    return Bridge(scope, FilesChannel(perimeter, allowed).handlers() + settings.handlers() + Unavailable.handlers())
}
