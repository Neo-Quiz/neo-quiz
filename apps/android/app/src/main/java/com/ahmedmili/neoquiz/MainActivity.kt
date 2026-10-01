package com.ahmedmili.neoquiz

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowInsets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import android.content.Intent
import com.ahmedmili.neoquiz.notify.ReviewAlarm
import com.ahmedmili.neoquiz.notify.ReviewOpenRequest
import com.ahmedmili.neoquiz.sync.SyncHub
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
        }
        granted = hasAllFilesAccess()
        askForNotifications()
        // Arms the daily review alarm (idempotent); a launch from its notification lands on Home.
        ReviewAlarm.scheduleNext(this)
        if (intent?.getBooleanExtra(ReviewAlarm.EXTRA_OPEN_REVIEW, false) == true) ReviewOpenRequest.raise()
        setContent {
            if (granted) AndroidView(factory = { appWebView }) else AndroidView(factory = { FirstRunScreen(it) })
        }
        // Edge-to-edge is enforced from targetSdk 35. The insets are applied once, as padding of the
        // activity's content view (a listener on the WebView itself never fires: Compose's AndroidView
        // does not dispatch insets to its child), so every screen, native or web, stays clear of the
        // status bar, the 3-button or gesture navigation bar, the cutout and the keyboard.
        val content = findViewById<ViewGroup>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        loadWhenGranted()
        // Back goes back in the page's own history; only when it has none does the app leave.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!loaded) return finish()
                appWebView.askBack { handled -> if (!handled) finish() }
            }
        })
    }

    /**
     * The app was already running when the review notification was tapped: the page restarts, and its
     * startup asks `android.revisionDemandee` and lands on Home (where today's review is). The app was in
     * the background, so its buffered writes have already been flushed.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!intent.getBooleanExtra(ReviewAlarm.EXTRA_OPEN_REVIEW, false)) return
        ReviewOpenRequest.raise()
        if (loaded) appWebView.reload()
    }

    /** Android 13+: asked once, at first run, so the sync service's notification shows. Never blocks anything. */
    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("sync", MODE_PRIVATE)
        if (prefs.getBoolean("notifications_asked", false)) return
        prefs.edit().putBoolean("notifications_asked", true).apply()
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    /** The app is visible again: files may have changed (sync, another app). Silent until the page has hydrated. */
    override fun onStart() {
        super.onStart()
        SyncHub.get(this).apply {
            foreground = true
            resume()
        }
        appWebView.rescan()
    }

    override fun onStop() {
        SyncHub.get(this).foreground = false
        super.onStop()
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
        // Sync stays on once a device was paired: bring its foreground service back (the app is on screen, so Android allows it).
        if (granted) SyncHub.get(this).let { if (it.isActive()) it.startService() }
    }

    override fun onDestroy() {
        appWebView.destroy()
        super.onDestroy()
    }
}
