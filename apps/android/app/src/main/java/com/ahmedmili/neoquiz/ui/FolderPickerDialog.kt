package com.ahmedmili.neoquiz.ui

import android.app.Activity
import android.app.AlertDialog
import android.os.Environment
import android.widget.ArrayAdapter
import android.widget.ListView
import com.ahmedmili.neoquiz.R
import com.ahmedmili.neoquiz.bridge.FolderPicker
import java.io.File
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * The folder picker behind `dialogue.choisirDossier`: lists the directories of
 * shared storage, starting at its root, and answers a real path (the system
 * document picker answers `content://` URIs, which the bridge cannot use). The
 * storage root itself cannot be picked: a root there would scan the whole phone.
 * Plain views, like the first-run screen: no extra UI dependency.
 *
 * [suggested] is a folder worth offering first (the synced `Documents/Neo Quiz`
 * while it is not a root yet); it is the first row of the storage root.
 */
class FolderPickerDialog(private val activity: Activity, private val suggested: () -> File?) : FolderPicker {
    private class Row(val label: String, val dir: File)

    override suspend fun pick(): File? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            val storage = Environment.getExternalStorageDirectory()
            val suggestion = suggested()
            var current = storage
            val rows = ArrayList<Row>()
            val adapter = ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1)
            val list = ListView(activity).apply { this.adapter = adapter }
            val dialog = AlertDialog.Builder(activity, R.style.Theme_NeoQuiz_Dialog)
                .setView(list)
                .setPositiveButton(R.string.picker_use) { _, _ -> if (cont.isActive) cont.resume(current) }
                .setNegativeButton(R.string.picker_cancel) { _, _ -> if (cont.isActive) cont.resume(null) }
                .setOnCancelListener { if (cont.isActive) cont.resume(null) }
                .create()

            fun show(dir: File) {
                current = dir
                rows.clear()
                if (dir == storage && suggestion != null) {
                    rows.add(Row(activity.getString(R.string.picker_suggested, suggestion.relativeTo(storage).path.replace('\\', '/')), suggestion))
                }
                if (dir != storage) dir.parentFile?.let { rows.add(Row(activity.getString(R.string.picker_up), it)) }
                dir.listFiles().orEmpty()
                    // `Android` (data, obb) belongs to other apps and is outside the perimeter anyway.
                    .filter { it.isDirectory && !it.name.startsWith(".") && !(dir == storage && it.name == "Android") }
                    .sortedBy { it.name.lowercase() }
                    .forEach { rows.add(Row(it.name + "/", it)) }
                adapter.clear()
                adapter.addAll(rows.map { it.label })
                dialog.setTitle(if (dir == storage) "/" else "/" + dir.relativeTo(storage).path.replace('\\', '/'))
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = dir != storage
            }

            list.setOnItemClickListener { _, _, position, _ -> show(rows[position].dir) }
            cont.invokeOnCancellation { dialog.dismiss() }
            dialog.show()
            // Dialog buttons are all-caps by default in the Material theme; labels stay in sentence case.
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.isAllCaps = false
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.isAllCaps = false
            show(storage)
        }
    }
}
