package com.ahmedmili.neoquiz.ui

import androidx.activity.ComponentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * `sync.scanner`: opens the camera (ZXing's capture screen, which asks for the
 * CAMERA permission itself) and answers the text of the first QR code read, or
 * `null` when the user gave up. The text is only ever a candidate: the Sync page
 * normalises it and `sync.appairer` validates it as a device id (format and
 * check characters) and asks for confirmation before anything is paired.
 *
 * Must be created while the activity is being created: an activity-result
 * launcher cannot be registered later.
 */
class QrScanner(activity: ComponentActivity) {
    @Volatile private var pending: CompletableDeferred<String?>? = null

    private val launcher = activity.registerForActivityResult(ScanContract()) { result ->
        pending?.complete(result.contents)
        pending = null
    }

    suspend fun scan(): String? = withContext(Dispatchers.Main) {
        if (pending != null) return@withContext null
        val answer = CompletableDeferred<String?>()
        pending = answer
        launcher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setBeepEnabled(false)
                .setOrientationLocked(false)
                .setPrompt(""),
        )
        answer.await()
    }
}
