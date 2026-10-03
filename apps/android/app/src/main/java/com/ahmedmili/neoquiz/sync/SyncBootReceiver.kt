package com.ahmedmili.neoquiz.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * When the phone starts (or after an update of the app), sync starts again on its own, as soon as it was switched on
 * once (a first pairing): the default for everyone (owner's decision, 2026-10-03, same as Neo Calendar). Nothing is
 * started otherwise. On HyperOS the app also needs the "Autostart" permission, without which the system drops this
 * broadcast.
 */
class SyncBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val hub = SyncHub.get(context)
        if (!hub.isActive()) return
        hub.startService()
    }
}
