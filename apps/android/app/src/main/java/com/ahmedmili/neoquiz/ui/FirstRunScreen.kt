package com.ahmedmili.neoquiz.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.ahmedmili.neoquiz.R

/**
 * True once "All files access" is granted (the quiz folder lives in shared
 * storage). Android 10 (API 29) has no such setting: it is treated as granted
 * there, and the legacy storage permissions are not handled yet.
 */
fun hasAllFilesAccess(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()

/**
 * The first-run screen: explains why, then opens the system page where the
 * user grants "All files access" to this app. Plain views, no extra UI
 * dependency; the activity swaps it for the app once the access is granted
 * (it re-checks on resume, i.e. when the user comes back from the setting).
 */
class FirstRunScreen(context: Context) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        val pad = (24 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad)
        addView(TextView(context).apply {
            setText(R.string.first_run_title)
            textSize = 22f
            setPadding(0, 0, 0, pad / 2)
        })
        addView(TextView(context).apply {
            setText(R.string.first_run_body)
            textSize = 16f
            setPadding(0, 0, 0, pad)
        })
        addView(Button(context).apply {
            setText(R.string.first_run_button)
            setOnClickListener {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@setOnClickListener
                context.startActivity(
                    Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")),
                )
            }
        })
    }
}
