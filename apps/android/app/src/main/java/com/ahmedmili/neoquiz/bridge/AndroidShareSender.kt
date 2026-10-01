package com.ahmedmili.neoquiz.bridge

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * `ACTION_SEND` of a file the bridge itself wrote under the cache's `share/` folder, through the app's
 * FileProvider (read-only grant for the app the user picks). The page never names the path.
 */
class AndroidShareSender(private val context: Context) : ShareSender {
    override suspend fun send(file: File, mime: String): Boolean {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        return try {
            withContext(Dispatchers.Main) {
                context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
