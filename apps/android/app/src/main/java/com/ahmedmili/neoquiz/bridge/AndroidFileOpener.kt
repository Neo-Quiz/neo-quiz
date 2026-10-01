package com.ahmedmili.neoquiz.bridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

/** `ACTION_VIEW` on a `content://` URI of the app's FileProvider, read-only for the receiving app. */
class AndroidFileOpener(private val context: Context) : FileOpener {
    override fun open(file: File): Boolean {
        // An unknown type is refused: a `*/*` view could reach the package installer (an extension-less APK).
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: return false
        if (mime == "application/vnd.android.package-archive") return false
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
