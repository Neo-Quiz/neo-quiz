package com.ahmedmili.neoquiz.sync

import com.ahmedmili.neoquiz.bridge.text
import org.json.JSONArray

/**
 * The `sync` group of the bridge, mirror of the three verbs of `Pont.sync`
 * (Task 6) plus `sync.scanner`, which exists on Android only (the camera):
 * the page reaches THREE verbs, a scan, and two pushes (`sync.etat`,
 * `sync.donneesRecues`, emitted by the hub's listeners), never a folder, a path, a
 * port, the API key or a REST call. A device id is validated before it reaches
 * a config, and pairing is confirmed in a native dialog the page cannot answer.
 */
class SyncChannel(private val backend: SyncBackend, private val scanner: suspend () -> String?) {
    fun handlers(): Map<String, suspend (JSONArray) -> Any?> = mapOf(
        "sync.etat" to { _ -> backend.state() },
        "sync.appairer" to { a -> backend.pair(a.text(0)) },
        "sync.oublier" to { a -> backend.forget(a.text(0)) },
        "sync.scanner" to { _ -> scanner() },
    )
}
