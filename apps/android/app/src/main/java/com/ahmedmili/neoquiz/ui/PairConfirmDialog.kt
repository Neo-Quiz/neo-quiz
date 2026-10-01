package com.ahmedmili.neoquiz.ui

import android.app.Activity
import android.app.AlertDialog
import com.ahmedmili.neoquiz.R
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
 */
class PairConfirmDialog(private val activity: Activity) {
    suspend fun ask(deviceId: String, name: String): Boolean = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            val shown = if (name.isBlank()) deviceId else "$name\n$deviceId"
            val dialog = AlertDialog.Builder(activity)
                .setTitle(R.string.pair_title)
                .setMessage(activity.getString(R.string.pair_message, shown))
                .setPositiveButton(R.string.pair_confirm) { _, _ -> if (cont.isActive) cont.resume(true) }
                .setNegativeButton(R.string.pair_cancel) { _, _ -> if (cont.isActive) cont.resume(false) }
                .setOnCancelListener { if (cont.isActive) cont.resume(false) }
                .create()
            cont.invokeOnCancellation { dialog.dismiss() }
            dialog.show()
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.requestFocus()
        }
    }
}
