package com.ahmedmili.neoquiz.sync

/**
 * What the foreground-service notification says, computed from the SAME state the Sync page gets
 * (`SyncEngine.state()`: `actif`, `appareils` with `connecte` / `enPause`, `dossier` with `etat` /
 * `pourcentage`). Pure: the service turns it into strings.
 */
data class SyncSummary(val kind: Kind, val percent: Int?, val connected: Int) {
    enum class Kind { STARTING, PAUSED, SCANNING, ERROR, NO_DEVICE, SYNCING, UP_TO_DATE }

    companion object {
        /** `null` (no state yet) is "starting". Order matters: paused, then what the folder does, then who is there. */
        fun of(state: Map<String, Any?>?): SyncSummary {
            if (state == null) return SyncSummary(Kind.STARTING, null, 0)
            val devices = (state["appareils"] as? List<*>)?.filterIsInstance<Map<*, *>>() ?: emptyList()
            val connected = devices.count { it["connecte"] == true }
            if (state["actif"] != true) return SyncSummary(Kind.PAUSED, null, 0)
            if (devices.isNotEmpty() && devices.all { it["enPause"] == true }) return SyncSummary(Kind.PAUSED, null, connected)
            val folder = state["dossier"] as? Map<*, *>
            return when (folder?.get("etat")) {
                "scanning" -> SyncSummary(Kind.SCANNING, null, connected)
                "error" -> SyncSummary(Kind.ERROR, null, connected)
                else -> when {
                    connected == 0 -> SyncSummary(Kind.NO_DEVICE, null, 0)
                    folder?.get("etat") == "syncing" -> SyncSummary(Kind.SYNCING, (folder["pourcentage"] as? Number)?.toInt()?.coerceIn(0, 100), connected)
                    else -> SyncSummary(Kind.UP_TO_DATE, null, connected)
                }
            }
        }
    }
}
