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
 * `ACTION_SEND` of a file the bridge itself wrote under the cache's `share/` folder, through the
 * share-only [ShareFileProvider] (read-only grant for the app the user picks, `ClipData` so the grant
 * also covers the chooser's previews). The page never names the path.
 */
class AndroidShareSender(private val context: Context) : ShareSender {
    override suspend fun send(file: File, mime: String): Boolean {
        val uri = FileProvider.getUriForFile(context, ShareFileProvider.authority(context.packageName), file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        return try {
            withContext(Dispatchers.Main) {
                context.startActivity(
                    Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION),
                )
            }
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}

/**
 * The relay's sender: `ACTION_SEND` (text only, or one file) or `ACTION_SEND_MULTIPLE` (several files)
 * with `EXTRA_TEXT`, through the same share-only [ShareFileProvider] and read-only grant.
 */
class AndroidPromptSender(private val context: Context) : PromptSender {
    override suspend fun send(text: String, files: List<File>): Boolean {
        val authority = ShareFileProvider.authority(context.packageName)
        val uris = ArrayList(files.map { FileProvider.getUriForFile(context, authority, it) })
        val send = when (uris.size) {
            0 -> Intent(Intent.ACTION_SEND).setType("text/plain")
            1 -> Intent(Intent.ACTION_SEND).setType(if (files[0].name.endsWith(".md", true)) "text/markdown" else "text/plain").putExtra(Intent.EXTRA_STREAM, uris[0])
            else -> Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        }
        send.putExtra(Intent.EXTRA_TEXT, text).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (uris.isNotEmpty()) {
            send.clipData = ClipData.newRawUri(files[0].name, uris[0]).also { c -> uris.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
        }
        return try {
            withContext(Dispatchers.Main) {
                context.startActivity(
                    Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION),
                )
            }
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
