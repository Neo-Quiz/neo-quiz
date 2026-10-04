package com.ahmedmili.neoquiz.ui

import android.app.Activity
import android.content.Intent
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "QrScanner"
private const val XIAOMI_SCAN_ACTION = "miui.intent.action.scanbarcode"

/**
 * `sync.scanner`: Neo Calendar's mechanism (2026-10-04). The phone's own scanner
 * when it has one (Xiaomi / HyperOS), otherwise Google's (Google Play services).
 * Both are full-screen PORTRAIT scanners with their own camera and permission:
 * the app asks for no camera permission and only keeps the text read. The old
 * ZXing capture screen opened in landscape.
 *
 * Answers `null` when the user gave up. The text is only ever a candidate: the
 * Sync page normalises it and `sync.appairer` validates it as a device id
 * (format and check characters) before anything is paired.
 *
 * Must be created while the activity is being created: an activity-result
 * launcher cannot be registered later.
 */
class QrScanner(private val activity: ComponentActivity) {
    @Volatile private var pending: CompletableDeferred<String?>? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val answer = pending ?: return@registerForActivityResult
        val text = if (result.resultCode == Activity.RESULT_OK) result.data?.extras?.getString("result")?.takeIf { it.isNotBlank() } else null
        when {
            text != null -> finish(answer, text)
            result.resultCode == Activity.RESULT_OK -> {
                // Accepted but no text: this scanner's format is not the expected one. Log the keys, never the values.
                Log.w(TAG, "Native scanner: OK without text, extras = ${result.data?.extras?.keySet()}")
                scanWithGoogle(answer)
            }
            else -> finish(answer, null)
        }
    }

    private fun finish(answer: CompletableDeferred<String?>, text: String?) {
        if (pending === answer) pending = null
        answer.complete(text)
    }

    /** The activity goes away: a scan still waiting answers "gave up" instead of staying pending forever. */
    fun detach() {
        pending?.complete(null)
        pending = null
    }

    suspend fun scan(): String? = withContext(Dispatchers.Main) {
        if (pending != null) return@withContext null
        val answer = CompletableDeferred<String?>()
        pending = answer
        val intent = Intent(XIAOMI_SCAN_ACTION).putExtra("isBackToThirdApp", true)
        if (intent.resolveActivity(activity.packageManager) != null) {
            try {
                launcher.launch(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Native scanner could not be started", e)
                scanWithGoogle(answer)
            }
        } else {
            scanWithGoogle(answer)
        }
        answer.await()
    }

    /** Google's QR code scanner (Google Play services): its screen, its camera, its permission. */
    private fun scanWithGoogle(answer: CompletableDeferred<String?>) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { barcode -> finish(answer, barcode.rawValue) }
            .addOnCanceledListener { finish(answer, null) }
            .addOnFailureListener { e ->
                Log.w(TAG, "Google scanner unavailable", e)
                finish(answer, null)
            }
    }
}
