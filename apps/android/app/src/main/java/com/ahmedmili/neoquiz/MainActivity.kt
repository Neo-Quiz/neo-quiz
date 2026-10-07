package com.ahmedmili.neoquiz

import android.Manifest
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.view.WindowInsets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import android.content.res.Configuration
import androidx.core.view.WindowInsetsCompat
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import android.content.Intent
import com.ahmedmili.neoquiz.bridge.IncomingIntent
import com.ahmedmili.neoquiz.notify.ReviewAlarm
import com.ahmedmili.neoquiz.notify.ReviewOpenRequest
import com.ahmedmili.neoquiz.sync.PairLinkRequest
import com.ahmedmili.neoquiz.sync.ShareRules
import com.ahmedmili.neoquiz.sync.SyncHub
import com.ahmedmili.neoquiz.ui.FirstRunBackdrop
import com.ahmedmili.neoquiz.ui.FirstRunScreen
import com.ahmedmili.neoquiz.ui.hasBackgroundSync
import com.ahmedmili.neoquiz.ui.isFirstRunDone
import com.ahmedmili.neoquiz.ui.hasAllFilesAccess
import com.ahmedmili.neoquiz.web.AppWebView

class MainActivity : ComponentActivity() {
    private lateinit var appWebView: AppWebView
    private var granted by mutableStateOf(false)
    private var backgroundSync by mutableStateOf(false)
    private var firstRunDone by mutableStateOf(false)

    /** The app shows once files are reachable and the first-run screen was left (or had nothing left to ask). */
    private val showApp get() = granted && (firstRunDone || backgroundSync)
    private var loaded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A phone stays in portrait; only a tablet (smallest width of 600 dp and more) turns with the screen
        // (owner's rule, 2026-10-04: the landscape layout is for tablets).
        requestedOrientation = if (resources.configuration.smallestScreenWidthDp >= 600) {
            ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        } else {
            ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
        }
        appWebView = AppWebView(this).apply {
            // AndroidView sizes a view by its layout params: wrap_content left the page 118 px tall.
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        granted = hasAllFilesAccess()
        backgroundSync = hasBackgroundSync(this)
        firstRunDone = isFirstRunDone(this)
        askForNotifications()
        // Arms the daily review alarm (idempotent); a launch from its notification lands on Home.
        ReviewAlarm.scheduleNext(this)
        if (intent?.getBooleanExtra(ReviewAlarm.EXTRA_OPEN_REVIEW, false) == true) ReviewOpenRequest.raise()
        // Not on a recreation or a relaunch from the recent apps: the link was already handled (or is old).
        if (savedInstanceState == null && intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0) {
            raisePairLink(intent)
            // A zip or note another app opened or shared with us: copied to the cache, then read once by the page.
            IncomingIntent.handle(this, intent)
        }
        setContent {
            val app = showApp
            // The first-run screen sits on the installer's backdrop, drawn as the window background so it
            // also fills the system-bar areas; the app gets its plain page colour back.
            SideEffect {
                if (app) window.setBackgroundDrawableResource(R.color.window_background)
                else if (window.decorView.background !is FirstRunBackdrop) window.setBackgroundDrawable(FirstRunBackdrop(this))
            }
            if (app) {
                AndroidView(factory = { withNavBar() })
            } else {
                AndroidView(
                    factory = { FirstRunScreen(it) { firstRunDone = true } },
                    update = { it.refresh(files = granted, sync = backgroundSync) },
                )
            }
        }
        // Edge-to-edge is enforced from targetSdk 35. The insets are applied once, as padding of the
        // activity's content view (a listener on the WebView itself never fires: Compose's AndroidView
        // does not dispatch insets to its child), so every screen, native or web, stays clear of the
        // status bar, the 3-button or gesture navigation bar, the cutout and the keyboard.
        val content = findViewById<ViewGroup>(android.R.id.content)
        // The app is always dark: light status/navigation bar icons on the dark background.
        WindowCompat.getInsetsController(window, content).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            // The TOP is not padded (2026-10-04): the page runs under the status bar so the wallpaper
            // shows behind it, and the page itself moves its content down by that height
            // (`--nq-inset-haut`, mobile.css). The sides, the bottom bars and the keyboard stay padded.
            v.setPadding(bars.left, 0, bars.right, bars.bottom)
            appWebView.setTopInset(bars.top / resources.displayMetrics.density)
            WindowInsetsCompat.CONSUMED
        }
        loadWhenGranted()
        // Back goes back in the page's own history; only when it has none does the app leave.
        // Predictive back (manifest `enableOnBackInvokedCallback`): while the finger drags from the edge
        // the page shrinks and follows it, like the system's own back animation; it springs back on
        // cancel and on commit (the page then shows its previous screen, or the activity leaves).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackStarted(backEvent: BackEventCompat) = appWebView.backPreview(backEvent.progress, backEvent.swipeEdge)

            override fun handleOnBackProgressed(backEvent: BackEventCompat) = appWebView.backPreview(backEvent.progress, backEvent.swipeEdge)

            override fun handleOnBackCancelled() = appWebView.backPreview(0f, BackEventCompat.EDGE_LEFT)

            override fun handleOnBackPressed() {
                appWebView.backPreview(0f, BackEventCompat.EDGE_LEFT)
                if (!loaded) return finish()
                appWebView.askBack { handled -> if (!handled) finish() }
            }
        })
    }

    /**
     * The WebView above, the page's bottom tab bar under it. The bar is a native view because the
     * overscroll stretch is drawn over the whole WebView: a bar inside the page stretched with it.
     */
    private fun withNavBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        addView(appWebView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(appWebView.navBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    /**
     * Rotation, fold/unfold and dark-mode changes are handled here (manifest `configChanges`) instead
     * of recreating the activity, which reloaded the whole page. The WebView resizes itself and fires
     * its own resize/media-query events; the insets are re-dispatched because they change with the
     * orientation (bar sides, cutout).
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content))
    }

    /**
     * The app was already running when the review notification was tapped: the page restarts, and its
     * startup asks `android.revisionDemandee` and lands on Home (where today's review is). The app was in
     * the background, so its buffered writes have already been flushed.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        raisePairLink(intent)
        IncomingIntent.handle(this, intent)
        if (!intent.getBooleanExtra(ReviewAlarm.EXTRA_OPEN_REVIEW, false)) return
        ReviewOpenRequest.raise()
        if (loaded) appWebView.reload()
    }

    /** A pairing link (`neo-quiz://pair`, the site's `/pair/`): validated here, handed to the page, which only fills in "Add a device". */
    private fun raisePairLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        ShareRules.externalPairing(intent.dataString)?.let { PairLinkRequest.raise(it) }
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

    /** Coming back from the "All files access" or battery setting. */
    override fun onResume() {
        super.onResume()
        granted = hasAllFilesAccess()
        backgroundSync = hasBackgroundSync(this)
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
