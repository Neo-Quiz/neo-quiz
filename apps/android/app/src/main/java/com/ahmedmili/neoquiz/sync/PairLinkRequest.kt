package com.ahmedmili.neoquiz.sync

/**
 * "A pairing link opened the app": the activity validates it ([ShareRules.externalPairing]) and
 * raises the canonical link here; the page reads it once (`sync.lienAppairage`) and only fills in
 * "Add a device" with it. Holds one link: a newer one replaces the older.
 */
object PairLinkRequest {
    @Volatile private var pending: String? = null
    /** Set by the bridge: tells a page that is already open to read the link. */
    @Volatile var listener: (() -> Unit)? = null

    fun raise(link: String) {
        pending = link
        listener?.invoke()
    }

    fun take(): String? = synchronized(this) { pending.also { pending = null } }
}
