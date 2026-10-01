package com.ahmedmili.neoquiz

import android.os.Bundle
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
        appWebView = AppWebView(this)
        granted = hasAllFilesAccess()
        setContent {
            if (granted) AndroidView(factory = { appWebView }) else AndroidView(factory = { FirstRunScreen(it) })
        }
        loadWhenGranted()
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
