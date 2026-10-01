package com.ahmedmili.neoquiz

import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowInsets
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import com.ahmedmili.neoquiz.ui.FirstRunScreen
import com.ahmedmili.neoquiz.ui.hasAllFilesAccess
import com.ahmedmili.neoquiz.web.AppWebView

class MainActivity : ComponentActivity() {
    private lateinit var appWebView: AppWebView
    private var granted by mutableStateOf(false)
    private var loaded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appWebView = AppWebView(this).apply {
            // AndroidView sizes a view by its layout params: wrap_content left the page 118 px tall.
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            // Edge-to-edge is enforced from targetSdk 35: keep the page clear of the bars and the keyboard.
            setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
        }
        granted = hasAllFilesAccess()
        setContent {
            if (granted) AndroidView(factory = { appWebView }) else AndroidView(factory = { FirstRunScreen(it) })
        }
        loadWhenGranted()
    }

    /** The app is visible again: files may have changed (sync, another app). Silent until the page has hydrated. */
    override fun onStart() {
        super.onStart()
        appWebView.rescan()
    }

    /** Coming back from the "All files access" setting. */
    override fun onResume() {
        super.onResume()
        granted = hasAllFilesAccess()
        loadWhenGranted()
    }

    private fun loadWhenGranted() {
        if (granted && !loaded) {
            loaded = true
            appWebView.loadApp()
        }
    }

    override fun onDestroy() {
        appWebView.destroy()
        super.onDestroy()
    }
}
