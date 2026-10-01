package com.ahmedmili.neoquiz

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.viewinterop.AndroidView
import com.ahmedmili.neoquiz.web.AppWebView

class MainActivity : ComponentActivity() {
    private lateinit var appWebView: AppWebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appWebView = AppWebView(this)
        setContent { AndroidView(factory = { appWebView }) }
        appWebView.loadApp()
    }

    override fun onDestroy() {
        appWebView.destroy()
        super.onDestroy()
    }
}
