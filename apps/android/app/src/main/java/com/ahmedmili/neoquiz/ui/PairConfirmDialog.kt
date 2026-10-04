package com.ahmedmili.neoquiz.ui

import android.app.Activity
import android.app.AlertDialog
import com.ahmedmili.neoquiz.R
import com.ahmedmili.neoquiz.sync.ShareRules
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * The NATIVE confirmation shown before a device is paired (mirror of the
 * `dialog.showMessageBox` of `main.ts`): it names the device id and, when
 * Syncthing knows it, the name, offers "Pair" and "Cancel", and Cancel is the
 * default (the focused button, and what a tap outside or Back answers). The page
 * can neither answer it nor draw it: it is an Android dialog of the activity.
 * `folder` is the synced folder as the owner sees it in the file manager (`Documents/Neo Quiz`).
 */
class PairConfirmDialog(private val activity: Activity, private val folder: String) {
    /** The path never wraps inside: no-break spaces, and a word joiner after each `/`. */
    private fun unbreakable(path: String) = path.replace(" ", " ").replace("/", "/⁠")

    suspend fun ask(deviceId: String, name: String): Boolean = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            // The name in the TITLE ("Pair DESKTOP-1U89520?", 2026-10-04: an id alone said nothing),
            // then "The folder Documents/Neo Quiz will be synced with this device" and the id. The name
            // is the other device's, so it is cleaned again here (no forged line, no reordered text).
            val clean = ShareRules.cleanName(name)
            val dialog = AlertDialog.Builder(activity, R.style.Theme_NeoQuiz_Dialog)
                .setTitle(if (clean.isEmpty()) activity.getString(R.string.pair_title) else activity.getString(R.string.pair_title_named, clean))
                .setMessage(activity.getString(R.string.pair_message, unbreakable(folder), activity.getString(R.string.pair_id_line, deviceId)))
                .setPositiveButton(R.string.pair_confirm) { _, _ -> if (cont.isActive) cont.resume(true) }
                .setNegativeButton(R.string.pair_cancel) { _, _ -> if (cont.isActive) cont.resume(false) }
                .setOnCancelListener { if (cont.isActive) cont.resume(false) }
                .create()
            cont.invokeOnCancellation { dialog.dismiss() }
            dialog.show()
            // Dialog buttons are all-caps by default in the Material theme; labels stay in sentence case.
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isAllCaps = false
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.isAllCaps = false
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.requestFocus()
            // A size at which the whole folder path fits on one line of the dialog.
            dialog.findViewById<android.widget.TextView>(android.R.id.message)?.textSize = 15f
        }
    }
}
