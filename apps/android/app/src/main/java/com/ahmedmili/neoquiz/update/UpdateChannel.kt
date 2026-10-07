package com.ahmedmili.neoquiz.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.ahmedmili.neoquiz.code.LanguagePacks
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray

/**
 * `miseAJour.etat`, `miseAJour.verifier` and `miseAJour.installer`: the same
 * three channels as the desktop's auto-updater (`pont.ts`), answered by the
 * [UpdateEngine]. The page never names a URL or a file: it only reads the
 * state, asks for a check, and taps Install.
 */
class UpdateChannel(private val engine: UpdateEngine, private val scope: CoroutineScope) {
    /** The app came to the foreground (or started): an automatic check, at most every 6 h. */
    fun onForeground() {
        scope.launch { engine.check(force = false) }
    }

    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "miseAJour.etat" to { _ -> engine.state.toMap() },
        "miseAJour.verifier" to { _ -> engine.check(force = true); true },
        // The download is long: the call answers at once, the page follows the pushed states.
        "miseAJour.installer" to { _ -> scope.launch { engine.install() }; null },
    )

    companion object {
        /** Builds the production engine: real network, real installer, state pushed to the page through [emit]. */
        fun create(context: Context, scope: CoroutineScope, emit: (Map<String, Any?>) -> Unit): UpdateChannel {
            val app = context.applicationContext
            val prefs = app.getSharedPreferences("update", Context.MODE_PRIVATE)
            val info = app.packageManager.getPackageInfo(app.packageName, 0)
            @Suppress("DEPRECATION")
            val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
            val engine = UpdateEngine(
                installedCode = code,
                installedName = info.versionName ?: "",
                dir = File(app.cacheDir, "update"),
                openManifest = { LanguagePacks.openHttps(UpdateRules.MANIFEST_URL, UpdateRules::manifestUrlAllowed, "application/json") },
                openApk = { url -> LanguagePacks.openHttps(url, UpdateRules::apkUrlAllowed, null) },
                store = object : CheckStore {
                    override fun lastCheck() = prefs.getLong("last_check", 0L)
                    override fun setLastCheck(ms: Long) = prefs.edit().putLong("last_check", ms).apply()
                },
                canInstall = { app.packageManager.canRequestPackageInstalls() },
                askPermission = {
                    // One screen, Neo Quiz's own "install unknown apps" switch; the page explains it in a line.
                    app.startActivity(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                },
                installer = { apk -> commitSession(app, apk) },
                onState = { emit(it.toMap()) },
            )
            engine.cleanup()
            UpdateResultReceiver.onFailure = { engine.installFailed() }
            return UpdateChannel(engine, scope)
        }

        /** Streams the verified APK into a PackageInstaller session and commits it; the result comes to [UpdateResultReceiver]. */
        private fun commitSession(app: Context, apk: File) {
            val installer = app.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(app.packageName)
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("NeoQuiz.apk", 0, apk.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                val result = Intent(app, UpdateResultReceiver::class.java).setAction(UpdateResultReceiver.ACTION)
                val pending = PendingIntent.getBroadcast(app, id, result, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                session.commit(pending.intentSender)
            }
        }
    }
}

/**
 * The answer of the system installer. It is not exported: only the system
 * (through the PendingIntent this app made) reaches it. A request for the
 * user's confirmation is shown at once; any failure or cancellation tells the
 * engine, which deletes the downloaded file.
 */
class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (confirm != null) context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> onFailure?.invoke()
        }
    }

    companion object {
        const val ACTION = "com.ahmedmili.neoquiz.update.RESULT"

        @Volatile var onFailure: (() -> Unit)? = null
    }
}
